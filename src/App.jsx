// src/App.jsx
import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore'; // IMPORTANTE: Agregar setDoc
import { auth, db } from './firebase';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

function App() {
  const [user, setUser] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (usuarioFirebase) => {
      if (usuarioFirebase) {
        setUser(usuarioFirebase);
        try {
          const userRef = doc(db, 'users', usuarioFirebase.uid);
          const userSnap = await getDoc(userRef);

          if (userSnap.exists()) {
            setIsRegistered(true); // Ya es miembro
          } else {
            setIsRegistered(false); // Es nuevo, le pediremos código
          }
        } catch (error) {
          console.error('Error verificando usuario', error);
        }
      } else {
        setUser(null);
        setIsRegistered(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Función que se ejecuta cuando ingresan el código VIP correcto
  const handleCodeSuccess = async () => {
    if (!user) return;
    try {
      // Lo registramos oficialmente en la base de datos
      await setDoc(doc(db, 'users', user.uid), {
        name: user.displayName || 'Nuevo Piloto',
        totalPoints: 0,
        isAdmin: false,
      });
      setIsRegistered(true); // Le damos acceso al Dashboard
    } catch (error) {
      console.error("Error al registrar usuario", error);
    }
  };

  // Función si deciden arrepentirse y cancelar
  const handleCancel = async () => {
    await signOut(auth);
  };

  if (loading) return <h2>Cargando ... 🏎️</h2>;

  // Si está logueado y registrado, entra directo
  if (user && isRegistered) {
    return <Dashboard />;
  }

  // Si no, lo mandamos al Login (le pasamos los props para pedir el código si es necesario)
  return (
    <Login
      requireCode={user && !isRegistered}
      onCodeSuccess={handleCodeSuccess}
      onCancel={handleCancel}
    />
  );
}

export default App;
