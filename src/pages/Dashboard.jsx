// src/pages/Dashboard.jsx
import React, { useEffect, useState } from 'react';
import { logout, auth, db } from '../firebase';
import { drivers2026 } from '../data/drivers';
import { getCurrentRace, races2026 } from '../data/races';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  onSnapshot,
  query,
  getDocs,
  collectionGroup,
  writeBatch,
  where,
} from 'firebase/firestore';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('current');
  const [currentRace, setCurrentRace] = useState(getCurrentRace());

  const [selectedDrivers, setSelectedDrivers] = useState([]);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [saving, setSaving] = useState(false);

  const [leaderboard, setLeaderboard] = useState([]);
  const [myHistory, setMyHistory] = useState([]);

  // ESTADO PARA LA TABLA DE PILOTOS
  const [driverStandings, setDriverStandings] = useState(drivers2026);

  // DATOS GLOBALES
  const [rivalsData, setRivalsData] = useState([]);
  const [selectedRivalRaceId, setSelectedRivalRaceId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // CONTROL DE SELECCIÓN
  const [isSelectionOpen, setIsSelectionOpen] = useState(true);

  // CONTROL DEL MENÚ DESPLEGABLE
  const [showMenu, setShowMenu] = useState(false);

  // ADMIN
  const [adminRaceId, setAdminRaceId] = useState(currentRace.id.toString());
  const [driverPoints, setDriverPoints] = useState({});
  const [isCalculating, setIsCalculating] = useState(false);

  // --- LÓGICA AUTOMÁTICA DE CARRERA ACTUAL ---
  useEffect(() => {
    async function determineNextRace() {
      try {
        const snapshot = await getDocs(collection(db, 'race_results'));
        const finishedRaceIds = snapshot.docs.map((doc) => parseInt(doc.id));
        const nextRace = races2026.find(
          (race) => !finishedRaceIds.includes(race.id)
        );

        if (nextRace && nextRace.id !== currentRace.id) {
          setCurrentRace(nextRace);
          setAdminRaceId(nextRace.id.toString());
        }
      } catch (error) {
        console.error('Error determinando la carrera actual:', error);
      }
    }
    determineNextRace();
  }, [isCalculating]);

  const [modal, setModal] = useState({
    show: false,
    title: '',
    message: '',
    type: 'alert',
    onConfirm: null,
  });

  // --- LÓGICA DE TIERS Y REGLA DE 4 CARRERAS ---
  let tierGroups = {
    banned: driverStandings.slice(0, 2),
    tier1: driverStandings.slice(2, 6),
    tier2: driverStandings.slice(6, 10),
    tier3: driverStandings.slice(10),
  };

  const getDriverTier = (driverId) => {
    if (tierGroups.banned.find((d) => String(d.id) === String(driverId))) return 'banned';
    if (tierGroups.tier1.find((d) => String(d.id) === String(driverId))) return 'tier1';
    if (tierGroups.tier2.find((d) => String(d.id) === String(driverId))) return 'tier2';
    if (tierGroups.tier3.find((d) => String(d.id) === String(driverId))) return 'tier3';
    return 'unknown';
  };

  // ============================================================================
  // MOTOR ESTRICTO DE VALIDACIÓN: REGLA DE 4 CARRERAS (Validado al 100%)
  // ============================================================================
  const getRuleBlockedDrivers = () => {
    // 1. Si no hay datos, no bloqueamos a nadie
    if (!auth?.currentUser || !rivalsData || !currentRace) return [];

    // 2. Obtenemos estrictamente las carreras pasadas de ESTE usuario, ordenadas cronológicamente
    const myPastRaces = rivalsData
      .filter((r) => r.userId === auth.currentUser.uid && Number(r.raceId) < Number(currentRace.id))
      .sort((a, b) => Number(a.raceId) - Number(b.raceId));

    const blockedIds = [];

    // 3. Mapeo inquebrantable a los índices de Firebase (Obligatorio G1->G2->G3)
    const tierMapping = { tier1: 0, tier2: 1, tier3: 2 };

    // 4. Evaluamos grupo por grupo de forma totalmente independiente
    ['tier1', 'tier2', 'tier3'].forEach((tier) => {
      const driverIndex = tierMapping[tier];

      // 5. Extraemos la "columna" de historial solo para este índice (Grupo)
      const pastDrivers = myPastRaces
        .map((race) => {
          // Seguridad extra: Validar que exista el array y la posición
          const d = race.drivers && race.drivers.length > driverIndex ? race.drivers[driverIndex] : null;
          return d ? String(d.id) : null; // Todo a String para evitar errores de tipo
        })
        .filter((id) => id !== null);

      const n = pastDrivers.length;

      // 6. Sometemos a cada piloto disponible HOY a la simulación estricta
      tierGroups[tier].forEach((driver) => {
        let isBlocked = false;
        const currentDriverId = String(driver.id);

        // --- REGLA A: Prevención de 3 iguales consecutivos ---
        // Aplica si al menos tienes 2 carreras jugadas
        if (n >= 2) {
          if (pastDrivers[n - 1] === pastDrivers[n - 2] && pastDrivers[n - 1] === currentDriverId) {
            isBlocked = true;
          }
        }

        // --- REGLA B: Ventana estricta de 4 carreras (Mínimo 3 diferentes) ---
        // Aplica si al menos tienes 3 carreras jugadas y el piloto no ha sido bloqueado por la Regla A
        if (n >= 3 && !isBlocked) {
          // Creamos un ecosistema con los 3 últimos elegidos + el intento de hoy
          const windowSet = new Set([
            pastDrivers[n - 1], // Hace 1 carrera
            pastDrivers[n - 2], // Hace 2 carreras
            pastDrivers[n - 3], // Hace 3 carreras
            currentDriverId,    // El piloto que estás intentando elegir hoy
          ]);

          // Si en este ecosistema de 4 espacios hay menos de 3 individuos únicos... BLOQUEO INMEDIATO.
          if (windowSet.size < 3) {
            isBlocked = true;
          }
        }

        // 7. Si el piloto reprobó la simulación, a la lista negra
        if (isBlocked) {
          // Evitamos IDs duplicados por si acaso
          if (!blockedIds.includes(driver.id)) {
            blockedIds.push(driver.id);
          }
        }
      });
    });

    return blockedIds; // Retornamos la lista de IDs condenados
  };


  const ruleBlockedDrivers = getRuleBlockedDrivers();

  // Inyectamos la propiedad 'isRuleBlocked' a los pilotos para que la UI sepa cuáles bloquear visualmente
  tierGroups = {
    ...tierGroups,
    tier1: tierGroups.tier1.map(d => ({ ...d, isRuleBlocked: ruleBlockedDrivers.includes(d.id) })),
    tier2: tierGroups.tier2.map(d => ({ ...d, isRuleBlocked: ruleBlockedDrivers.includes(d.id) })),
    tier3: tierGroups.tier3.map(d => ({ ...d, isRuleBlocked: ruleBlockedDrivers.includes(d.id) })),
  };


  // 1. VERIFICAR ADMIN (El registro de usuarios nuevos ya lo maneja App.jsx con el código VIP)
  useEffect(() => {
    async function checkAdmin() {
      if (!auth.currentUser) return;
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists() && userSnap.data().isAdmin === true) {
        setIsAdmin(true);
      }
    }
    checkAdmin();
  }, []);


  // 2. ESCUCHAR SWITCH
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'raceControl'), (docSnap) => {
      if (docSnap.exists()) {
        setIsSelectionOpen(docSnap.data().isOpen);
      } else {
        setDoc(doc(db, 'config', 'raceControl'), { isOpen: true });
        setIsSelectionOpen(true);
      }
    });
    return () => unsub();
  }, []);

  // 3. CARGAR USUARIOS
  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      usersData.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
      setLeaderboard(usersData);
    });
    return () => unsubscribe();
  }, []);

  // 4. CARGAR DATOS GLOBALES
  useEffect(() => {
    async function fetchAllRaces() {
      const q = query(collectionGroup(db, 'races'));
      const snapshot = await getDocs(q);
      const allRaces = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const pathSegments = docSnap.ref.path.split('/');
        const userId = pathSegments[1];
        allRaces.push({ ...data, userId: userId });
      });
      setRivalsData(allRaces);

      if (allRaces.length > 0) {
        const maxId = Math.max(...allRaces.map((r) => r.raceId));
        setSelectedRivalRaceId(maxId.toString());
      } else {
        setSelectedRivalRaceId(currentRace.id.toString());
      }
    }
    fetchAllRaces();
  }, [hasPlayed, currentRace]);

  // 5. CHECK STATUS
  useEffect(() => {
    async function checkStatus() {
      // RESETEO DE ESTADO AL CAMBIAR DE CARRERA
      setHasPlayed(false);
      setSelectedDrivers([]);

      if (!auth.currentUser) return;
      const userId = auth.currentUser.uid;
      const raceRef = doc(
        db,
        'users',
        userId,
        'races',
        currentRace.id.toString()
      );
      const raceSnap = await getDoc(raceRef);

      if (raceSnap.exists()) {
        setHasPlayed(true);
        setSelectedDrivers(raceSnap.data().drivers);
      }
    }
    checkStatus();
  }, [currentRace]);

  // 6. HISTORIAL
  const loadHistory = async () => {
    setActiveTab('history');
    if (!auth.currentUser) return;
    const q = collection(db, 'users', auth.currentUser.uid, 'races');
    const snapshot = await getDocs(q);
    const historyData = snapshot.docs
      .map((doc) => doc.data())
      .sort((a, b) => b.raceId - a.raceId);
    setMyHistory(historyData);
  };

  // 7. LEER TABLA DE PILOTOS DESDE FIREBASE
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'standings', 'season2026'),
      (docSnap) => {
        let totals = {};

        if (docSnap.exists()) {
          totals = docSnap.data().totals || {};
        }

        const updatedStandings = drivers2026.map((driver) => ({
          ...driver,
          totalSeasonPoints: totals[driver.id] || 0,
        }));

        updatedStandings.sort(
          (a, b) => b.totalSeasonPoints - a.totalSeasonPoints
        );

        setDriverStandings(updatedStandings);
      }
    );

    return () => unsubscribe();
  }, []);

  // 8. CARGAR PUNTOS GUARDADOS (ADMIN)
  useEffect(() => {
    async function loadSavedPoints() {
      if (!isAdmin || activeTab !== 'admin') return;

      try {
        const docRef = doc(db, 'race_results', adminRaceId.toString());
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setDriverPoints(docSnap.data().scores || {});
        } else {
          setDriverPoints({});
        }
      } catch (error) {
        console.error('Error cargando puntos guardados:', error);
      }
    }
    loadSavedPoints();
  }, [adminRaceId, isAdmin, activeTab]);

  // --- LÓGICA FALTANTES ---
  const currentRaceEntries = rivalsData.filter(
    (r) => r.raceId.toString() === currentRace.id.toString()
  );
  const playersReadyIds = currentRaceEntries.map((r) => r.userId);
  if (
    hasPlayed &&
    auth.currentUser &&
    !playersReadyIds.includes(auth.currentUser.uid)
  ) {
    playersReadyIds.push(auth.currentUser.uid);
  }
  const pendingUsers = leaderboard.filter(
    (u) => !playersReadyIds.includes(u.id)
  );
  const readyUsers = leaderboard.filter((u) => playersReadyIds.includes(u.id));

  // --- ACCIONES ---
  const toggleRaceLock = async () => {
    const newState = !isSelectionOpen;
    try {
      await setDoc(
        doc(db, 'config', 'raceControl'),
        { isOpen: newState },
        { merge: true }
      );
      showModal(
        'Configuración Actualizada',
        newState ? 'Selección ABIERTA.' : 'Selección CERRADA.',
        'alert'
      );
    } catch (e) {
      console.error(e);
    }
  };

  const sendWhatsAppReminder = () => {
    if (pendingUsers.length === 0) {
      showModal('¡Todo listo!', 'Nadie falta.', 'alert');
      return;
    }
    const names = pendingUsers.map((u) => u.name).join(', ');
    const message = `🏎️ *QUINIELA F1* 🚨\n\nFaltan por seleccionar pilotos para el *${currentRace.name}*:\n\n⏳ ${names}\n\n¡🏁🏁🏁! 🏁`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  const sendGeneralAlert = () => {
    const message = `🏎️ *QUINIELA F1* \n\n¡Este fin de semana hay carrera! 🏁\n\n*${currentRace.name}*\n\nNo olviden elegir pilotos antes de la Qualy/Sprint.\n\n¡🏁🏁🏁! 🏆`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  // --- MODAL & JUEGO ---
  const showModal = (title, message, type = 'alert', onConfirm = null) => {
    setModal({ show: true, title, message, type, onConfirm });
  };
  const closeModal = () => setModal({ ...modal, show: false });
  const handleModalConfirm = () => {
    if (modal.onConfirm) modal.onConfirm();
    closeModal();
  };

  // --- SELECCIÓN POR TIERS ---
  const toggleDriver = (driver) => {
    if (hasPlayed) return;
    if (!isSelectionOpen) {
      showModal(
        'Selección Bloqueada',
        'Las selecciones están cerradas.',
        'alert'
      );
      return;
    }

    // --- REGLA ESPECIAL: CARRERA 1 ---
    if (currentRace.id === 1) {
      const isSelected = selectedDrivers.find((d) => d.id === driver.id);
      if (isSelected) {
        setSelectedDrivers(selectedDrivers.filter((d) => d.id !== driver.id));
      } else {
        if (selectedDrivers.length < 3) {
          setSelectedDrivers([...selectedDrivers, driver]);
        } else {
          showModal(
            'Equipo Completo',
            'Ya tienes 3 pilotos. Desmarca uno para elegir otro.',
            'alert'
          );
        }
      }
      return;
    }
    // ---------------------------------

    const tier = getDriverTier(driver.id);

    if (tier === 'banned') {
      showModal(
        'Piloto Bloqueado',
        'Los 2 primeros lugares de la tabla no se pueden elegir.',
        'alert'
      );
      return;
    }

    // --- NUEVO: VALIDACIÓN DE REGLA 4 CARRERAS ---
    // Si el piloto que intentan tocar está en la lista negra calculada
    if (ruleBlockedDrivers.includes(driver.id)) {
      showModal(
        'Piloto Bloqueado (Regla 4 Carreras)',
        'No puedes elegir a este piloto porque tendrías menos de 3 pilotos diferentes en las últimas 4 carreras.',
        'alert'
      );
      return;
    }
    // ---------------------------------------------

    // --- REGLA ESTRICTA: Orden G1 -> G2 -> G3 ---
    const isAlreadySelected = selectedDrivers.find((d) => d.id === driver.id);
    const hasTier1Selected = selectedDrivers.some((d) => getDriverTier(d.id) === 'tier1');
    const hasTier2Selected = selectedDrivers.some((d) => getDriverTier(d.id) === 'tier2');

    if (!isAlreadySelected) {
      if (tier === 'tier2' && !hasTier1Selected) {
        showModal(
          'Selección Bloqueada',
          'Debes elegir PRIMERO un piloto del Grupo 1.',
          'alert'
        );
        return;
      }

      if (tier === 'tier3' && (!hasTier1Selected || !hasTier2Selected)) {
        showModal(
          'Selección Bloqueada',
          'Debes elegir pilotos del Grupo 1 y Grupo 2 ANTES de elegir uno del Grupo 3.',
          'alert'
        );
        return;
      }
    }
    // -----------------------------------------------------------

    const existingDriverInTier = selectedDrivers.find(
      (d) => getDriverTier(d.id) === tier
    );

    if (existingDriverInTier) {
      if (existingDriverInTier.id === driver.id) {
        // --- DESELECCIÓN EN CASCADA ---
        if (tier === 'tier1') {
          setSelectedDrivers([]);
        } else if (tier === 'tier2') {
          setSelectedDrivers(
            selectedDrivers.filter((d) => getDriverTier(d.id) === 'tier1')
          );
        } else {
          setSelectedDrivers(selectedDrivers.filter((d) => d.id !== driver.id));
        }
        // -------------------------------------
      } else {
        // CAMBIO DE PILOTO EN EL MISMO GRUPO (Swap)
        const newSelection = selectedDrivers.filter(
          (d) => d.id !== existingDriverInTier.id
        );
        setSelectedDrivers([...newSelection, driver]);
      }
    } else {
      if (selectedDrivers.length < 3) {
        setSelectedDrivers([...selectedDrivers, driver]);
      } else {
        showModal(
          'Equipo Completo',
          'Ya tienes 3 pilotos. Cambia uno de su respectivo grupo.',
          'alert'
        );
      }
    }
  };



  const handleSaveClick = () => {
    if (!isSelectionOpen) {
      showModal('Bloqueado', 'No se puede guardar.', 'alert');
      return;
    }

    if (currentRace.id === 1) {
      if (selectedDrivers.length !== 3) {
        showModal(
          'Selección Incompleta',
          'Debes elegir exactamente 3 pilotos.',
          'alert'
        );
        return;
      }
      showModal(
        '¿Confirmar Equipo?',
        'No podrás hacer cambios después.',
        'confirm',
        executeSave
      );
      return;
    }

    const t1 = selectedDrivers.find((d) => getDriverTier(d.id) === 'tier1');
    const t2 = selectedDrivers.find((d) => getDriverTier(d.id) === 'tier2');
    const t3 = selectedDrivers.find((d) => getDriverTier(d.id) === 'tier3');

    if (!t1 || !t2 || !t3) {
      showModal(
        'Selección Incompleta',
        'Debes elegir exactamente:\n\n1 Piloto del Group 1\n1 Piloto del Group 2\n1 Piloto del Group 3',
        'alert'
      );
      return;
    }

    showModal(
      '¿Confirmar Equipo?',
      'No podrás hacer cambios después.',
      'confirm',
      executeSave
    );
  };

  const executeSave = async () => {
    setSaving(true);
    try {
      const userId = auth.currentUser.uid;
      const driversWithPlaceholder = selectedDrivers.map((d) => ({
        ...d,
        position: null,
        pointsEarned: 0,
      }));
      await setDoc(
        doc(db, 'users', userId, 'races', currentRace.id.toString()),
        {
          raceId: currentRace.id,
          raceName: currentRace.name,
          drivers: driversWithPlaceholder,
          points: 0,
          status: 'pending',
          timestamp: new Date(), // ESTO YA LO TIENES, ES CORRECTO.
          selectionTime: new Date().toLocaleString(), // AGREGA ESTA LÍNEA EXTRA para lectura fácil si quieres
        }
      );
      await setDoc(
        doc(db, 'users', userId),
        { name: auth.currentUser.displayName },
        { merge: true }
      );
      setHasPlayed(true);
      setTimeout(
        () => showModal('¡Éxito!', 'Equipo confirmado.', 'alert'),
        500
      );
    } catch (error) {
      console.error(error);
      showModal('Error', 'Problema al guardar.', 'alert');
    }
    setSaving(false);
  };

  // Versión protegida contra errores
  const calculateTotalHistoryPoints = () => {
    if (!Array.isArray(myHistory)) return 0;
    return myHistory.reduce((acc, race) => acc + (race.points || 0), 0);
  };

  // --- FILTROS Y TABLAS ---
  const getPublicRivals = () =>
    rivalsData.filter(
      (r) =>
        r.raceId.toString() === selectedRivalRaceId.toString() &&
        r.raceId < currentRace.id
    );
  const getAdminData = () => {
    if (leaderboard.length > 0) {
      return leaderboard.map((user) => {
        const raceEntry = rivalsData.find(
          (r) =>
            r.userId === user.id &&
            r.raceId.toString() === selectedRivalRaceId.toString()
        );
        if (raceEntry)
          return { ...raceEntry, userName: user.name, hasPlayed: true };
        else
          return {
            userId: user.id,
            userName: user.name,
            drivers: [],
            points: 0,
            hasPlayed: false,
          };
      });
    }
    const activePlayers = rivalsData.filter(
      (r) => r.raceId.toString() === selectedRivalRaceId.toString()
    );
    return activePlayers.map((r) => ({
      ...r,
      userName: r.userName || 'Jugador',
      hasPlayed: true,
    }));
  };
  const availableRacesPublic = [
    ...new Set(
      rivalsData
        .filter((r) => r.raceId < currentRace.id)
        .map((item) => JSON.stringify({ id: item.raceId, name: item.raceName }))
    ),
  ]
    .map((s) => JSON.parse(s))
    .sort((a, b) => b.id - a.id);
  const allRacesOptions = [currentRace, ...rivalsData].map((r) => ({
    id: r.id || r.raceId,
    name: r.name || r.raceName,
  }));
  const uniqueAdminRaces = Array.from(
    new Map(allRacesOptions.map((item) => [item.id, item])).values()
  )
    .filter((race) => race.id <= currentRace.id)
    .sort((a, b) => b.id - a.id);

  // --- LÓGICA DE ADMIN: GUARDAR PUNTOS Y CALCULAR ---
  const handlePointChange = (driverId, points) => {
    setDriverPoints((prev) => ({
      ...prev,
      [driverId]: parseInt(points) || 0,
    }));
  };

  const saveAndCalculateScores = async () => {
    if (
      !window.confirm(
        '¿Seguro que deseas calcular los puntos? Esto actualizará el puntaje de TODOS los usuarios y la tabla de pilotos.'
      )
    )
      return;

    setIsCalculating(true);
    const batch = writeBatch(db);

    try {
      const resultsRef = doc(db, 'race_results', adminRaceId.toString());
      batch.set(resultsRef, {
        raceId: adminRaceId,
        scores: driverPoints,
        updatedAt: new Date(),
      });

      const usersQuery = query(
        collectionGroup(db, 'races'),
        where('raceId', '==', parseInt(adminRaceId))
      );
      const snapshot = await getDocs(usersQuery);
      const userUpdates = [];

      for (const docSnap of snapshot.docs) {
        const raceData = docSnap.data();
        const userId = docSnap.ref.parent.parent.id;

        let totalRacePoints = 0;
        const updatedDrivers = raceData.drivers.map((driver) => {
          const pointsEarned = driverPoints[driver.id] || 0;
          totalRacePoints += pointsEarned;
          return { ...driver, pointsEarned };
        });

        batch.update(docSnap.ref, {
          drivers: updatedDrivers,
          points: totalRacePoints,
          status: 'completed',
        });

        const updateUserTotal = async () => {
          const allRacesSnapshot = await getDocs(
            collection(db, 'users', userId, 'races')
          );
          let grandTotal = 0;
          allRacesSnapshot.forEach((rDoc) => {
            if (rDoc.id === adminRaceId.toString()) {
              grandTotal += totalRacePoints;
            } else {
              grandTotal += rDoc.data().points || 0;
            }
          });
          const userRef = doc(db, 'users', userId);
          await setDoc(userRef, { totalPoints: grandTotal }, { merge: true });
        };
        userUpdates.push(updateUserTotal());
      }

      const allResultsSnap = await getDocs(collection(db, 'race_results'));
      const driverTotals = {};

      allResultsSnap.forEach((doc) => {
        if (doc.id !== adminRaceId.toString()) {
          const scores = doc.data().scores || {};
          Object.keys(scores).forEach((dId) => {
            driverTotals[dId] =
              (driverTotals[dId] || 0) + (parseInt(scores[dId]) || 0);
          });
        }
      });

      Object.keys(driverPoints).forEach((dId) => {
        driverTotals[dId] =
          (driverTotals[dId] || 0) + (parseInt(driverPoints[dId]) || 0);
      });

      const standingsRef = doc(db, 'standings', 'season2026');
      batch.set(standingsRef, { totals: driverTotals }, { merge: true });

      await batch.commit();
      await Promise.all(userUpdates);

      showModal(
        '¡Éxito!',
        'Puntos de Usuarios y Pilotos actualizados.',
        'alert'
      );
    } catch (error) {
      console.error('Error calculando puntos:', error);
      showModal('Error', 'Hubo un problema al calcular.', 'alert');
    }

    setIsCalculating(false);
  };

  const ResultsTable = ({ data, isConfidential, showTimestamp }) => (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        backgroundColor: 'white',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
      }}
    >
      <thead>
        <tr
          style={{
            backgroundColor: '#1a1a1a',
            color: 'white',
            fontSize: '0.9rem',
            textAlign: 'left',
          }}
        >
          <th style={{ padding: '15px' }}>Jugador</th>
          <th style={{ padding: '15px' }}>
            {isConfidential ? 'Estado' : 'Pilotos Elegidos'}
          </th>
          {/* COLUMNA NUEVA SOLO SI showTimestamp ES TRUE */}
          {showTimestamp && <th style={{ padding: '15px' }}>Hora Selección</th>}
          <th style={{ padding: '15px', textAlign: 'center' }}>Total</th>
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr>
            <td
              colSpan={showTimestamp ? 4 : 3}
              style={{ padding: '20px', textAlign: 'center', color: '#999' }}
            >
              No hay datos disponibles.
            </td>
          </tr>
        ) : (
          data.map((entry, index) => {
            const userInLeaderboard = leaderboard.find(
              (u) => u.id === entry.userId
            );
            const displayName =
              entry.userName ||
              (userInLeaderboard ? userInLeaderboard.name : 'Jugador');

            // FORMATEO DE FECHA
            let dateStr = '--';
            if (entry.timestamp) {
              // Maneja si es Timestamp de Firebase o Date de JS
              const dateObj = entry.timestamp.toDate
                ? entry.timestamp.toDate()
                : new Date(entry.timestamp);
              dateStr = dateObj.toLocaleString('es-MX', {
                hour: '2-digit',
                minute: '2-digit',
                day: 'numeric',
                month: 'short',
              });
            }

            return (
              <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                <td
                  style={{ padding: '15px', fontWeight: 'bold', color: '#333' }}
                >
                  {displayName}
                </td>
                <td style={{ padding: '15px' }}>
                  {isConfidential ? (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        backgroundColor: '#fff3cd',
                        color: '#856404',
                        padding: '6px 12px',
                        borderRadius: '20px',
                        fontSize: '0.85rem',
                        fontWeight: 'bold',
                        border: '1px solid #ffeeba',
                      }}
                    >
                      <span>🔒</span> Confidencial (Oculto)
                    </div>
                  ) : !entry.drivers || entry.drivers.length === 0 ? (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        backgroundColor: '#f0f0f0',
                        color: '#999',
                        fontSize: '0.8rem',
                        fontStyle: 'italic',
                      }}
                    >
                      Sin selección
                    </span>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      {entry.drivers.map((d, i) => (
                        <div
                          key={i}
                          style={{ fontSize: '0.9rem', color: '#555' }}
                        >
                          <span style={{ fontWeight: '600', color: '#000' }}>
                            {d.name.split(' ').pop()}
                          </span>
                          <span
                            style={{
                              marginLeft: '5px',
                              color: d.pointsEarned > 0 ? '#006d58' : '#888',
                              fontSize: '0.85rem',
                            }}
                          >
                            {d.pointsEarned !== undefined
                              ? `(${d.pointsEarned} pts)`
                              : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>

                {/* CELDA DE FECHA NUEVA */}
                {showTimestamp && (
                  <td
                    style={{
                      padding: '15px',
                      fontSize: '0.85rem',
                      color: '#666',
                    }}
                  >
                    {dateStr}
                  </td>
                )}

                <td
                  style={{
                    padding: '15px',
                    textAlign: 'center',
                    fontWeight: '800',
                    fontSize: '1.2rem',
                    color: isConfidential
                      ? '#ccc'
                      : entry.points > 0
                        ? '#e10600'
                        : '#ccc',
                  }}
                >
                  {isConfidential ? '?' : entry.points}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  const DriverGroup = ({ title, drivers, tierName, isBlocked, color }) => (
    <div style={{ marginBottom: '30px' }}>
      <h4
        style={{
          margin: '0 0 15px 0',
          color: color,
          borderBottom: `2px solid ${color}`,
          paddingBottom: '5px',
          display: 'inline-block',
          textTransform: 'uppercase',
          fontSize: '0.9rem',
          letterSpacing: '1px',
        }}
      >
        {title}
      </h4>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '15px',
        }}
      >
        {drivers.map((driver) => {
          const isSelected = selectedDrivers.find((d) => d.id === driver.id);

          // 1. Bloqueo global (ya jugaste o selección cerrada)
          const isGlobalLocked = hasPlayed || (!isSelectionOpen && !hasPlayed);

          // 2. Bloqueo secuencial (esperando al G1 o G2)
          const isSequentialBlocked = isBlocked;

          // 3. Bloqueo de los demás pilotos del mismo grupo si ya elegiste uno
          const isAnotherSelectedInTier =
            currentRace.id !== 1 &&
            selectedDrivers.some((sd) => drivers.some((d) => d.id === sd.id)) &&
            !isSelected;

          // 4. Se pone gris si cumple CUALQUIERA de las condiciones de bloqueo
          const isVisuallyGrayedOut = isGlobalLocked || isSequentialBlocked || driver.isRuleBlocked || isAnotherSelectedInTier;

          // 5. El candado SOLO sale por penalización de reglas, baneados o si el juego cerró.
          const showLockIcon = driver.isRuleBlocked || tierName === 'banned' || isGlobalLocked;

          // 6. NUEVO: ¿Está completamente deshabilitado el clic?
          // Deshabilitamos el clic si el juego cerró (global) o si hay otro seleccionado en el mismo grupo.
          // (Nota: No bloqueamos el clic en isSequentialBlocked ni en ruleBlocked para que el usuario pueda hacer clic y ver el modal que le explica por qué no puede elegirlo).
          const isClickDisabled = isGlobalLocked || isAnotherSelectedInTier;

          return (
            <div
              key={driver.id}
              // AQUÍ ESTÁ LA MAGIA: Si está deshabilitado, el clic es ignorado por completo.
              onClick={() => !isClickDisabled && toggleDriver(driver)}
              style={{
                border: isSelected
                  ? `3px solid ${driver.color}`
                  : `1px solid ${isVisuallyGrayedOut ? '#eee' : '#ddd'}`,
                borderRadius: '12px',
                padding: '10px',
                textAlign: 'center',
                backgroundColor: isVisuallyGrayedOut ? '#f9f9f9' : 'white',
                opacity: isVisuallyGrayedOut && !isSelected ? 0.5 : 1,
                // Cambiamos el cursor a "prohibido" si está deshabilitado
                cursor: isClickDisabled ? 'not-allowed' : 'pointer',
                transform: isSelected ? 'translateY(-4px)' : 'none',
                boxShadow: isSelected
                  ? '0 8px 20px rgba(0,0,0,0.1)'
                  : '0 2px 5px rgba(0,0,0,0.02)',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ position: 'relative' }}>
                <img
                  src={driver.image}
                  alt={driver.name}
                  style={{
                    width: '100%',
                    height: '120px',
                    objectFit: 'cover',
                    objectPosition: 'top',
                    borderRadius: '8px',
                    marginBottom: '8px',
                    filter:
                      isVisuallyGrayedOut && !isSelected
                        ? 'grayscale(100%)'
                        : 'none',
                  }}
                />
                {isSelected && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 5,
                      right: 5,
                      background: driver.color,
                      color: 'white',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                    }}
                  >
                    ✓
                  </div>
                )}
                {showLockIcon && !isSelected && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      fontSize: '1.5rem',
                    }}
                  >
                    🔒
                  </div>
                )}
              </div>
              <div
                style={{ fontSize: '0.9rem', fontWeight: '700', color: '#333' }}
              >
                {driver.name}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#666' }}>
                {driver.team}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // --- FUNCIÓN HELPER PARA CAMBIAR PESTAÑA DESDE EL MENÚ ---
  const handleMenuClick = (tab) => {
    setActiveTab(tab);
    if (tab === 'history') loadHistory();
    setShowMenu(false);
  };

  // Helper para el nombre de la pestaña actual
  const getActiveTabName = () => {
    switch (activeTab) {
      case 'current':
        return 'Inicio';
      case 'rules':
        return 'Reglas del Juego';
      case 'leaderboard':
        return 'Quiniela';
      case 'standings':
        return 'Pilotos';
      case 'rivals':
        return 'Espiar';
      case 'history':
        return 'Mi Historial';
      case 'admin':
        return 'Admin';
      default:
        return 'Menú';
    }
  };

  return (
    <div
      style={{
        padding: '20px',
        fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        maxWidth: '900px',
        margin: '0 auto',
        paddingBottom: '100px',
        backgroundColor: '#f8f9fa',
        minHeight: '100vh',
      }}
    >
      {/* 1. MENSAJE DE BIENVENIDA (ARRIBA DEL HEADER) */}
      <h2 style={{ margin: '0 0 10px 0', fontSize: '1.2rem', color: '#555' }}>
        Bienvenido,{' '}
        <span style={{ color: '#000', fontWeight: 'bold' }}>
          {auth.currentUser?.displayName}
        </span>
      </h2>

      {/* HEADER (SIN LABEL DE NOMBRE, SOLO TÍTULO Y SALIR) */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          backgroundColor: 'white',
          padding: '15px',
          borderRadius: '12px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          🏁{' '}
          <span
            style={{ color: '#e10600', fontWeight: '900', fontStyle: 'italic' }}
          >
            F1
          </span>{' '}
          Quiniela
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={logout}
            style={{
              padding: '6px 14px',
              background: '#1f1f1f',
              color: '#fff',
              border: 'none',
              borderRadius: '20px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 'bold',
            }}
          >
            Salir
          </button>
        </div>
      </header>

      {/* MENÚ DROPDOWN (REEMPLAZA LAS PESTAÑAS) */}
      <div style={{ marginBottom: '25px', position: 'relative', zIndex: 200 }}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          style={{
            width: '100%',
            padding: '14px',
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '12px',
            textAlign: 'left',
            fontWeight: 'bold',
            color: '#333',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
            cursor: 'pointer',
          }}
        >
          <span>☰ {getActiveTabName()}</span>
          <span>▼</span>
        </button>

        {showMenu && (
          <div
            style={{
              position: 'absolute',
              top: '110%',
              left: 0,
              width: '100%',
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
              overflow: 'hidden',
              border: '1px solid #eee',
            }}
          >
            <div
              onClick={() => handleMenuClick('current')}
              style={dropdownItemStyle}
            >
              🏎️ Inicio
            </div>
            <div
              onClick={() => handleMenuClick('leaderboard')}
              style={dropdownItemStyle}
            >
              🏆 Quiniela
            </div>
            <div
              onClick={() => handleMenuClick('standings')}
              style={dropdownItemStyle}
            >
              📊 Pilotos
            </div>
            <div
              onClick={() => handleMenuClick('rivals')}
              style={dropdownItemStyle}
            >
              👀 Espiar
            </div>
            <div
              onClick={() => handleMenuClick('history')}
              style={dropdownItemStyle}
            >
              📜 Mi Historial
            </div>
            <div
              onClick={() => handleMenuClick('rules')}
              style={dropdownItemStyle}
            >
              📋 Reglas
            </div>
            {isAdmin && (
              <div
                onClick={() => handleMenuClick('admin')}
                style={{
                  ...dropdownItemStyle,
                  color: '#e10600',
                  borderTop: '1px solid #eee',
                }}
              >
                🔒 Admin
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- VISTA 1: JUGAR --- */}
      {activeTab === 'current' && (
        <>
          <div
            style={{
              display: 'flex',
              gap: '20px',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              marginBottom: '30px',
            }}
          >
            {/* PANEL IZQUIERDO */}
            <div
              style={{
                flex: '2 1 400px',
                backgroundColor: 'white',
                borderRadius: '16px',
                overflow: 'hidden',
                textAlign: 'center',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                border: '1px solid #eee',
              }}
            >
              <div
                style={{
                  backgroundColor: '#e10600',
                  color: 'white',
                  padding: '12px',
                  fontSize: '0.9rem',
                  fontWeight: '800',
                  letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                }}
              >
                Próximo Grand Prix
              </div>
              <div style={{ padding: '30px 20px' }}>
                <h2
                  style={{
                    margin: '0 0 8px 0',
                    fontSize: '1.6rem',
                    color: '#1a1a1a',
                    fontWeight: '700',
                  }}
                >
                  {currentRace.name}
                </h2>
                <p
                  style={{
                    color: '#666',
                    margin: 0,
                    fontWeight: '500',
                    fontSize: '0.8rem',
                  }}
                >
                  {currentRace.circuit}
                </p>
                <p
                  style={{
                    color: '#666',
                    margin: 0,
                    fontWeight: '500',
                    fontSize: '0.8rem',
                  }}
                >
                  {currentRace.date}
                </p>
                <div
                  style={{
                    margin: '10px auto',
                    maxWidth: '220px',
                    padding: '5px',
                  }}
                >
                  <img
                    src={currentRace.image}
                    alt="Circuit"
                    style={{
                      width: '100%',
                      height: 'auto',
                      display: 'block',
                      opacity: 0.9,
                    }}
                  />
                </div>
                {hasPlayed ? (
                  <div
                    style={{
                      display: 'inline-block',
                      marginTop: '8px',
                      padding: '6px 16px',
                      backgroundColor: '#e6fffa',
                      color: '#006d58',
                      borderRadius: '50px',
                      fontWeight: 'bold',
                      fontSize: '0.75rem',
                      border: '1px solid #b7ebdf',
                      letterSpacing: '0.5px',
                    }}
                  >
                    ✅ EQUIPO CONFIRMADO
                  </div>
                ) : !isSelectionOpen ? (
                  <div
                    style={{
                      display: 'inline-block',
                      marginTop: '8px',
                      padding: '6px 16px',
                      backgroundColor: '#f8d7da',
                      color: '#721c24',
                      borderRadius: '50px',
                      fontWeight: 'bold',
                      fontSize: '0.75rem',
                      border: '1px solid #f5c6cb',
                      letterSpacing: '0.5px',
                    }}
                  >
                    🔒 SELECCIÓN CERRADA
                  </div>
                ) : (
                  <p
                    style={{
                      color: '#e10600',
                      fontWeight: '600',
                      fontSize: '0.85rem',
                      margin: '10px 0 0 0',
                    }}
                  >
                    Selecciona tus 3 pilotos para competir
                  </p>
                )}
              </div>
            </div>

            {/* PANEL DERECHO: ESTADO */}
            <div
              style={{
                flex: '1 1 250px',
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '20px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                border: '1px solid #eee',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: '0 0 15px 0',
                    color: '#1a1a1a',
                    fontSize: '1.1rem',
                    borderBottom: '1px solid #eee',
                    paddingBottom: '10px',
                  }}
                >
                  🚦 Jugadores
                </h3>
                <div style={{ marginBottom: '20px' }}>
                  <h4
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '0.9rem',
                      color: '#e10600',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>🚨 Faltan</span>
                    <span
                      style={{
                        backgroundColor: '#e10600',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                      }}
                    >
                      {pendingUsers.length}
                    </span>
                  </h4>
                  {pendingUsers.length > 0 ? (
                    <ul
                      style={{
                        listStyle: 'none',
                        padding: 0,
                        margin: 0,
                        fontSize: '0.9rem',
                      }}
                    >
                      {pendingUsers.map((u) => (
                        <li
                          key={u.id}
                          style={{
                            padding: '6px 0',
                            borderBottom: '1px solid #f9f9f9',
                            color: '#666',
                          }}
                        >
                          {u.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p
                      style={{
                        fontSize: '0.8rem',
                        color: '#999',
                        fontStyle: 'italic',
                      }}
                    >
                      Nadie falta.
                    </p>
                  )}
                  {pendingUsers.length > 0 && (
                    <button
                      onClick={sendWhatsAppReminder}
                      style={{
                        width: '100%',
                        marginTop: '10px',
                        padding: '8px',
                        backgroundColor: 'white',
                        color: '#e10600',
                        border: '1px solid #e10600',
                        borderRadius: '6px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                      }}
                    >
                      <span>📲</span> Enviar Recordatorio
                    </button>
                  )}
                </div>
                <div style={{ marginBottom: '20px' }}>
                  <h4
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '0.9rem',
                      color: '#006d58',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>✅ Listos</span>
                    <span
                      style={{
                        backgroundColor: '#006d58',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                      }}
                    >
                      {readyUsers.length}
                    </span>
                  </h4>
                  {readyUsers.length > 0 ? (
                    <ul
                      style={{
                        listStyle: 'none',
                        padding: 0,
                        margin: 0,
                        fontSize: '0.9rem',
                      }}
                    >
                      {readyUsers.map((u) => (
                        <li
                          key={u.id}
                          style={{
                            padding: '6px 0',
                            borderBottom: '1px solid #f9f9f9',
                            color: '#333',
                            fontWeight: '500',
                          }}
                        >
                          {u.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p
                      style={{
                        fontSize: '0.8rem',
                        color: '#999',
                        fontStyle: 'italic',
                      }}
                    >
                      Esperando...
                    </p>
                  )}
                </div>
              </div>

              {/* BOTONES DE ACCIÓN */}
              <div>
                <button
                  onClick={sendGeneralAlert}
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 10px rgba(0, 123, 255, 0.2)',
                    fontSize: '0.9rem',
                    marginBottom: '10px',
                  }}
                >
                  <span>📢</span> Aviso General
                </button>

                {/* BOTÓN DE BLOQUEO (SOLO ADMIN) - AHORA AQUÍ ABAJO */}
                {isAdmin && (
                  <button
                    onClick={toggleRaceLock}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: isSelectionOpen ? '#28a745' : '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      fontSize: '0.9rem',
                    }}
                  >
                    {isSelectionOpen
                      ? '🔓 Bloquear Selección'
                      : '🔒 Desbloquear Selección'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ========================================================= */}
          {/* PANEL DE DEBUG (OCULTO PARA PRODUCCIÓN)                     */}
          {/* 🛠️ Para volver a verlo, cambia el "false" de abajo a "true" */}
          {/* ========================================================= */}
          {false && (
            <div style={{
              background: '#1a1a1a',
              color: '#00ff00',
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '20px',
              fontFamily: 'monospace',
              fontSize: '13px',
              border: '2px dashed #ff0000'
            }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#fff' }}>🛠️ MODO DEBUG: Regla 4 Carreras</h4>

              <p style={{ margin: '5px 0' }}>
                Carreras pasadas encontradas en la BD para ti:
                <strong style={{ color: 'yellow', marginLeft: '5px' }}>
                  {rivalsData?.filter((r) => r.userId === auth?.currentUser?.uid && Number(r.raceId) < Number(currentRace?.id)).length || 0}
                </strong>
              </p>

              <div style={{ background: '#000', padding: '10px', borderRadius: '5px', margin: '10px 0' }}>
                <strong style={{ color: '#fff' }}>📋 Detalle de tus selecciones pasadas (Por Índice):</strong>
                {rivalsData
                  ?.filter((r) => r.userId === auth?.currentUser?.uid && Number(r.raceId) < Number(currentRace?.id))
                  .sort((a, b) => Number(a.raceId) - Number(b.raceId))
                  .map(race => (
                    <div key={race.raceId} style={{ marginTop: '8px', borderBottom: '1px solid #333', paddingBottom: '8px' }}>
                      <span style={{ color: '#00ffff' }}>Carrera {race.raceId} ({race.raceName}):</span>
                      <ul style={{ margin: '4px 0 0 20px', padding: 0, color: '#ccc', listStyleType: 'square' }}>
                        {race.drivers?.map((d, idx) => (
                          <li key={d.id}>
                            {d.name} <span style={{ color: '#888' }}>(ID: {d.id})</span> - Guardado como: <strong style={{ color: 'orange' }}>Grupo {idx + 1}</strong>
                          </li>
                        )) || <li>Sin pilotos</li>}
                      </ul>
                    </div>
                  ))}
              </div>

              <hr style={{ borderColor: '#333', margin: '10px 0' }} />

              <p style={{ margin: '5px 0' }}><strong>🚫 Bloqueados G1:</strong> {tierGroups.tier1.filter(d => ruleBlockedDrivers.includes(d.id)).map(d => d.name).join(', ') || 'Ninguno'}</p>
              <p style={{ margin: '5px 0' }}><strong>🚫 Bloqueados G2:</strong> {tierGroups.tier2.filter(d => ruleBlockedDrivers.includes(d.id)).map(d => d.name).join(', ') || 'Ninguno'}</p>
              <p style={{ margin: '5px 0' }}><strong>🚫 Bloqueados G3:</strong> {tierGroups.tier3.filter(d => ruleBlockedDrivers.includes(d.id)).map(d => d.name).join(', ') || 'Ninguno'}</p>
            </div>
          )}
          {/* ========================================================= */}


          <h3
            style={{
              margin: '0 0 15px 0',
              color: '#333',
              fontSize: '1.4rem',
              fontWeight: '800',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            🏎️ Selecciona tus Pilotos
            {!isSelectionOpen && (
              <span
                style={{
                  fontSize: '0.9rem',
                  color: '#e10600',
                  border: '1px solid #e10600',
                  padding: '2px 8px',
                  borderRadius: '4px',
                }}
              >
                BLOQUEADO
              </span>
            )}
          </h3>

          {/* NUEVA LEYENDA INFORMATIVA */}
          <div
            style={{
              backgroundColor: '#f8f9fa',
              borderLeft: '4px solid #007bff',
              padding: '12px 15px',
              borderRadius: '0 8px 8px 0',
              marginBottom: '25px',
              fontSize: '0.85rem',
              color: '#555',
              lineHeight: '1.5',
            }}
          >
            💡 <strong>Tip:</strong> Para cambiar a un piloto, haz clic sobre él para <strong>desmarcarlo</strong>.
            Esto reiniciará tu selección y podrás hacer cambios. <strong>Una vez confirmados tus 3 pilotos ya no podrás modificar tu selección</strong>
          </div>


          {/* GRID DE SELECCIÓN POR TIERS */}
          {/* GRID DE SELECCIÓN POR TIERS */}
          <DriverGroup
            // Si es la carrera 1 cambiamos el título y quitamos el bloqueo
            title={
              currentRace.id === 1
                ? '🔥 Top 2 (¡DISPONIBLES!)'
                : '🚫 Top 2 (Bloqueados)'
            }
            drivers={tierGroups.banned}
            tierName="banned"
            // Aquí está la clave: Solo está bloqueado si NO es la carrera 1
            isBlocked={currentRace.id !== 1}
            color="#999"
          />
          <DriverGroup
            title="🥇 Group 1"
            drivers={tierGroups.tier1}
            tierName="tier1"
            isBlocked={false}
            color="#d4af37"
          />
          <DriverGroup
            title="🥈 Group 2"
            drivers={tierGroups.tier2}
            tierName="tier2"
            isBlocked={
              currentRace.id !== 1 &&
              !selectedDrivers.some((d) => getDriverTier(d.id) === 'tier1')
            }
            color="#C0C0C0"
          />
          <DriverGroup
            title="🥉 Group 3"
            drivers={tierGroups.tier3}
            tierName="tier3"
            isBlocked={
              currentRace.id !== 1 &&
              (!selectedDrivers.some((d) => getDriverTier(d.id) === 'tier1') ||
                !selectedDrivers.some((d) => getDriverTier(d.id) === 'tier2'))
            }
            color="#cd7f32"
          />

          {!hasPlayed && (
            <div
              style={{
                position: 'fixed',
                bottom: 30,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 100,
              }}
            >
              <button
                onClick={handleSaveClick}
                disabled={
                  selectedDrivers.length !== 3 || saving || !isSelectionOpen
                }
                style={{
                  padding: '16px 45px',
                  backgroundColor: !isSelectionOpen
                    ? '#999'
                    : selectedDrivers.length === 3
                      ? '#e10600'
                      : '#333',
                  color: 'white',
                  border: 'none',
                  borderRadius: '50px',
                  fontWeight: '800',
                  fontSize: '1.1rem',
                  cursor:
                    !isSelectionOpen || selectedDrivers.length !== 3
                      ? 'not-allowed'
                      : 'pointer',
                  boxShadow: '0 10px 30px rgba(0,0,0, 0.2)',
                  transition: 'transform 0.1s',
                }}
              >
                {saving
                  ? 'Guardando...'
                  : !isSelectionOpen
                    ? '🔒 SELECCIÓN CERRADA'
                    : `CONFIRMAR (${selectedDrivers.length}/3)`}
              </button>
            </div>
          )}
        </>
      )}

      {/* --- VISTAS 2 a 6 (Igual que antes) --- */}
      {activeTab === 'leaderboard' && (
        <div
          style={{
            backgroundColor: 'white',
            padding: '0',
            borderRadius: '16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '25px',
              borderBottom: '1px solid #eee',
              textAlign: 'center',
            }}
          >
            <h2 style={{ margin: 0, color: '#1a1a1a' }}>🏆 Quiniela</h2>
            <p style={{ color: '#888', margin: '5px 0 0 0' }}>
              Leaderboard
            </p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {leaderboard.map((user, index) => (
                <tr key={user.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td
                    style={{
                      padding: '20px',
                      width: '50px',
                      textAlign: 'center',
                      fontSize: '1.2rem',
                      fontWeight: 'bold',
                      color: index === 0 ? '#d4af37' : '#999',
                    }}
                  >
                    {index + 1}
                  </td>
                  <td
                    style={{
                      padding: '20px',
                      fontWeight: '600',
                      color: '#333',
                      fontSize: '1.1rem',
                    }}
                  >
                    {user.name}{' '}
                    {user.id === auth.currentUser.uid && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          marginLeft: '10px',
                          background: '#e10600',
                          color: 'white',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          verticalAlign: 'middle',
                        }}
                      >
                        TÚ
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      padding: '20px',
                      textAlign: 'right',
                      fontWeight: '800',
                      color: '#e10600',
                      fontSize: '1.2rem',
                    }}
                  >
                    {user.totalPoints || 0}{' '}
                    <span
                      style={{
                        fontSize: '0.8rem',
                        color: '#999',
                        fontWeight: 'normal',
                      }}
                    >
                      pts
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'standings' && (
        <div
          style={{
            backgroundColor: 'white',
            padding: '0',
            borderRadius: '16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '25px',
              borderBottom: '1px solid #eee',
              textAlign: 'center',
              backgroundColor: '#15151e',
            }}
          >
            <h2 style={{ margin: 0, color: 'white' }}>📊 F1 Standings</h2>
            <p style={{ color: '#aaa', margin: '5px 0 0 0' }}>
              Campeonato de Pilotos 2026
            </p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  textAlign: 'left',
                  borderBottom: '1px solid #eee',
                  fontSize: '0.8rem',
                  color: '#999',
                  textTransform: 'uppercase',
                }}
              >
                <th style={{ padding: '15px' }}>Pos</th>
                <th style={{ padding: '15px' }}>Piloto</th>
                <th style={{ padding: '15px', textAlign: 'right' }}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {/* CAMBIO: Usamos driverStandings en lugar de drivers2026 */}
              {driverStandings.map((driver, index) => (
                <tr
                  key={driver.id}
                  style={{ borderBottom: '1px solid #f9f9f9' }}
                >
                  <td
                    style={{
                      padding: '15px',
                      fontWeight: 'bold',
                      color: '#333',
                    }}
                  >
                    {index + 1}
                  </td>
                  <td style={{ padding: '10px 15px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '15px',
                      }}
                    >
                      <img
                        src={driver.image}
                        alt={driver.name}
                        style={{
                          width: '45px',
                          height: '45px',
                          borderRadius: '50%',
                          objectFit: 'cover',
                          objectPosition: 'top',
                          border: `2px solid ${driver.color}`,
                          padding: '2px',
                          backgroundColor: 'white',
                        }}
                      />
                      <div>
                        <div style={{ fontWeight: 'bold', color: '#1a1a1a' }}>
                          {driver.name}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#666' }}>
                          {driver.team}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td
                    style={{
                      padding: '15px',
                      textAlign: 'right',
                      fontWeight: 'bold',
                      fontSize: '1.1rem',
                      color: driver.totalSeasonPoints > 0 ? '#e10600' : '#333',
                    }}
                  >
                    {driver.totalSeasonPoints}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'rivals' && (
        <div>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#444' }}>
              👀 Espiar Rivales
            </h3>

            {/* DROPDOWN CORREGIDO: Muestra carreras hasta la ACTUAL */}
            <select
              value={selectedRivalRaceId}
              onChange={(e) => setSelectedRivalRaceId(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                fontSize: '1rem',
                backgroundColor: 'white',
                boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
                marginBottom: '20px',
              }}
            >
              {races2026
                .filter((r) => r.id <= currentRace.id) // Filtra futuras carreras
                .sort((a, b) => b.id - a.id) // Ordena (más reciente arriba)
                .map((race) => (
                  <option key={race.id} value={race.id}>
                    {race.name} {race.id === currentRace.id ? '(EN CURSO)' : ''}
                  </option>
                ))}
            </select>

            <div>
              <ResultsTable
                // Filtramos los datos para la carrera seleccionada
                data={rivalsData.filter(
                  (r) => r.raceId.toString() === selectedRivalRaceId.toString()
                )}
                // SI EL ID SELECCIONADO ES IGUAL AL DE LA CARRERA ACTUAL -> CONFIDENCIAL
                isConfidential={
                  selectedRivalRaceId.toString() === currentRace.id.toString()
                }
              />
            </div>
          </div>
        </div>
      )}

      {isAdmin && activeTab === 'admin' && (
        <div>
          <div
            style={{
              marginBottom: '20px',
              border: '2px dashed #e10600',
              padding: '15px',
              borderRadius: '12px',
            }}
          >
            <h3 style={{ margin: '0 0 15px 0', color: '#e10600' }}>
              🔒 Panel de Admin (God Mode)
            </h3>
            <select
              value={selectedRivalRaceId}
              onChange={(e) => setSelectedRivalRaceId(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                fontSize: '1rem',
                backgroundColor: 'white',
              }}
            >
              {races2026.map((race) => (
                <option key={race.id} value={race.id}>
                  {race.name} {race.id === currentRace.id ? '(ACTUAL)' : ''}
                </option>
              ))}
            </select>
            <div style={{ marginTop: '20px' }}>
              <ResultsTable data={getAdminData()} showTimestamp={true} />
            </div>

            {/* --- NUEVO BLOQUE: CARGA DE PUNTOS --- */}
            <div
              style={{
                marginTop: '40px',
                borderTop: '2px dashed #ccc',
                paddingTop: '20px',
              }}
            >
              <h3 style={{ color: '#333' }}>🧮 Cargar Resultados Oficiales</h3>

              <div style={{ marginBottom: '15px' }}>
                <label style={{ marginRight: '10px', fontWeight: 'bold' }}>
                  Seleccionar Carrera:
                </label>
                <select
                  value={adminRaceId}
                  onChange={(e) => setAdminRaceId(e.target.value)}
                  style={{ padding: '8px', borderRadius: '5px' }}
                >
                  {/* CAMBIO: Usamos races2026 aquí también */}
                  {races2026.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: '10px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  padding: '10px',
                  border: '1px solid #eee',
                  borderRadius: '8px',
                }}
              >
                {drivers2026.map((driver) => (
                  <div
                    key={driver.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px',
                      backgroundColor: '#f9f9f9',
                      borderRadius: '6px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <img
                        src={driver.image}
                        style={{
                          width: '30px',
                          height: '30px',
                          borderRadius: '50%',
                          objectFit: 'cover',
                          objectPosition: 'top',
                        }}
                      />
                      <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>
                        {driver.name.split(' ').pop()}
                      </span>
                    </div>
                    <input
                      type="number"
                      placeholder="0"
                      value={driverPoints[driver.id] || ''}
                      onChange={(e) =>
                        handlePointChange(driver.id, e.target.value)
                      }
                      style={{
                        width: '60px',
                        padding: '5px',
                        borderRadius: '4px',
                        border: '1px solid #ddd',
                        textAlign: 'center',
                      }}
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={saveAndCalculateScores}
                disabled={isCalculating}
                style={{
                  marginTop: '20px',
                  width: '100%',
                  padding: '15px',
                  backgroundColor: isCalculating ? '#999' : '#006d58',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  fontSize: '1rem',
                  cursor: isCalculating ? 'wait' : 'pointer',
                }}
              >
                {isCalculating
                  ? 'Calculando Resultados...'
                  : '💾 GUARDAR Y CALCULAR PUNTOS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- VISTA DE REGLAS --- */}
      {activeTab === 'rules' && (
        <div
          style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
          }}
        >
          <h2
            style={{
              color: '#e10600',
              borderBottom: '2px solid #eee',
              paddingBottom: '10px',
            }}
          >
            📋 Reglas del Juego
          </h2>

          <div style={{ marginTop: '20px', color: '#333', lineHeight: '1.6' }}>
            <h3 style={{ color: '#1a1a1a' }}>🏁 Selección de Pilotos</h3>
            <ul style={{ paddingLeft: '20px' }}>
              <li>
                <strong>Carrera 1:</strong> Se puede elegir cualquier piloto sin
                restricción alguna.
              </li>
              <li>
                <strong>Carrera 2 en adelante:</strong> Los{' '}
                <strong>2 primeros pilotos</strong> con más puntos en la tabla
                general serán bloqueados y no se podrán elegir.
              </li>
            </ul>

            <p style={{ fontWeight: 'bold', marginTop: '15px' }}>
              Debes elegir tu equipo con la siguiente estructura:
            </p>
            <ul
              style={{
                listStyleType: 'none',
                padding: 0,
                background: '#f9f9f9',
                padding: '15px',
                borderRadius: '8px',
              }}
            >
              <li>
                🥇 1 piloto del <strong>Grupo 1</strong>
              </li>
              <li>
                🥈 1 piloto del <strong>Grupo 2</strong>
              </li>
              <li>
                🥉 1 piloto del <strong>Grupo 3</strong>
              </li>
            </ul>

            <h3 style={{ color: '#1a1a1a', marginTop: '30px' }}>
              🔄 Regla principal:
            </h3>
            <div
              style={{
                background: '#fff3cd',
                padding: '15px',
                borderLeft: '5px solid #ffc107',
                borderRadius: '4px',
              }}
            >
              <p style={{ margin: 0 }}>
                Tienes que tener al menos{' '}
                <strong>3 pilotos diferentes en las últimas 4 carreras</strong>{' '}
                para cada grupo (G1, G2 y G3).
              </p>
              <p
                style={{
                  margin: '10px 0 0 0',
                  fontSize: '0.9rem',
                  color: '#856404',
                }}
              >
                ⚠️ El incumplimiento de esta regla será motivo de{' '}
                <strong>anulación de puntos</strong>.
              </p>
            </div>

            <h3 style={{ color: '#e10600', marginTop: '30px' }}>
              ⚖️ Penalizaciones por Tiempo
            </h3>
            <p>
              Si seleccionas tus pilotos durante o después de la Qualy/Sprint
              serás penalizado de la siguiente forma:
            </p>

            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                marginTop: '10px',
                fontSize: '0.9rem',
              }}
            >
              <thead>
                <tr style={{ background: '#f1f1f1', textAlign: 'left' }}>
                  <th style={{ padding: '10px' }}>Tiempo de Retraso</th>
                  <th style={{ padding: '10px' }}>Penalización</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px' }}>0 - 30 min tarde</td>
                  <td
                    style={{
                      padding: '10px',
                      color: '#e10600',
                      fontWeight: 'bold',
                    }}
                  >
                    -15% de los puntos totales al final de la carrera principal
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px' }}>30 - 60 min tarde</td>
                  <td
                    style={{
                      padding: '10px',
                      color: '#e10600',
                      fontWeight: 'bold',
                    }}
                  >
                    -30% de los puntos totales al final de la carrera principal
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '10px' }}>Más de 60 min tarde</td>
                  <td
                    style={{
                      padding: '10px',
                      color: '#e10600',
                      fontWeight: 'bold',
                    }}
                  >
                    -50% de los puntos totales al final de la carrera principal
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
              padding: '0 5px',
            }}
          >
            <h3 style={{ margin: 0, color: '#444' }}>📜 Tus Resultados</h3>
            <div
              style={{
                backgroundColor: '#1a1a1a',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '30px',
                fontWeight: 'bold',
                fontSize: '0.9rem',
                boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
              }}
            >
              TOTAL:{' '}
              <span
                style={{
                  color: '#d4af37',
                  fontSize: '1.1rem',
                  marginLeft: '5px',
                }}
              >
                {calculateTotalHistoryPoints()}
              </span>{' '}
              PTS
            </div>
          </div>
          {!myHistory || myHistory.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px',
                color: '#999',
                backgroundColor: 'white',
                borderRadius: '16px',
              }}
            >
              <p>Aún no has participado en ninguna carrera.</p>
            </div>
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
            >
              {myHistory.map((race, index) => (
                <div
                  key={index}
                  style={{
                    borderRadius: '16px',
                    padding: '25px',
                    backgroundColor: 'white',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
                    borderLeft: '6px solid #e10600',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '25px',
                      borderBottom: '1px solid #f0f0f0',
                      paddingBottom: '15px',
                    }}
                  >
                    <h2
                      style={{
                        margin: 0,
                        fontSize: '1.3rem',
                        color: '#1a1a1a',
                      }}
                    >
                      {race.raceName}
                    </h2>
                    <div
                      style={{
                        backgroundColor:
                          race.points > 0 ? '#e6fffa' : '#f5f5f5',
                        color: race.points > 0 ? '#006d58' : '#888',
                        padding: '8px 16px',
                        borderRadius: '30px',
                        fontWeight: 'bold',
                        fontSize: '0.95rem',
                      }}
                    >
                      {race.points > 0 ? `+${race.points} PTS` : '0'}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '15px',
                      justifyContent: 'space-around',
                    }}
                  >
                    {/* PROTECCIÓN AGREGADA AQUÍ: race.drivers && */}
                    {race.drivers &&
                      race.drivers.map((d) => (
                        <div
                          key={d.id}
                          style={{ textAlign: 'center', width: '33%' }}
                        >
                          <div
                            style={{
                              position: 'relative',
                              display: 'inline-block',
                            }}
                          >
                            <img
                              src={d.image}
                              style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                border: `3px solid ${d.color}`,
                                objectFit: 'cover',
                                objectPosition: 'top',
                                padding: '2px',
                                backgroundColor: 'white',
                              }}
                            />
                            <div
                              style={{
                                position: 'absolute',
                                bottom: 0,
                                right: -5,
                                background: '#222',
                                color: 'white',
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                fontSize: '0.7rem',
                                fontWeight: 'bold',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid white',
                              }}
                            >
                              {d.position ? `P${d.position}` : '?'}
                            </div>
                          </div>
                          <div
                            style={{
                              fontSize: '0.95rem',
                              marginTop: '8px',
                              fontWeight: '700',
                              color: '#333',
                            }}
                          >
                            {d.name.split(' ').pop()}
                          </div>
                          <div
                            style={{
                              marginTop: '2px',
                              fontSize: '0.85rem',
                              color: '#666',
                            }}
                          >
                            {d.pointsEarned
                              ? `+${d.pointsEarned} pts`
                              : '-- pts'}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL */}
      {modal.show && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '20px',
              maxWidth: '350px',
              width: '90%',
              textAlign: 'center',
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
              animation: 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: '1.5rem', color: '#1a1a1a' }}>
              {modal.title}
            </h3>
            <p
              style={{
                color: '#666',
                fontSize: '1rem',
                lineHeight: '1.5',
                marginBottom: '25px',
              }}
            >
              {modal.message}
            </p>
            <div
              style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}
            >
              {modal.type === 'confirm' && (
                <button
                  onClick={closeModal}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '50px',
                    border: 'none',
                    backgroundColor: '#f0f0f0',
                    color: '#333',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={handleModalConfirm}
                style={{
                  padding: '10px 25px',
                  borderRadius: '50px',
                  border: 'none',
                  backgroundColor: '#e10600',
                  color: 'white',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  boxShadow: '0 4px 10px rgba(225, 6, 0, 0.3)',
                }}
              >
                {modal.type === 'confirm' ? 'Confirmar' : 'Entendido'}
              </button>
            </div>
          </div>
          <style>{`@keyframes popIn { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }`}</style>
        </div>
      )}
    </div>
  );
}

// Estilo simple para los items del menú dropdown
const dropdownItemStyle = {
  padding: '15px 20px',
  borderBottom: '1px solid #f5f5f5',
  cursor: 'pointer',
  fontSize: '0.95rem',
  color: '#333',
  fontWeight: '500',
  transition: 'background 0.2s',
  '&:hover': {
    background: '#f9f9f9',
  },
};
