// src/firebase.js
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// --- PEGA AQUÍ TU CONFIGURACIÓN DE FIREBASE (Lo que copiaste del paso 1) ---
const firebaseConfig = {
  apiKey: 'AIzaSyDUG2AyvnWhPYMh49Ei7uzVnJdVHQQGS10',
  authDomain: 'f1-fantasy-f1.firebaseapp.com',
  projectId: 'f1-fantasy-f1',
  storageBucket: 'f1-fantasy-f1.firebasestorage.app',
  messagingSenderId: '671384694064',
  appId: '1:671384694064:web:5c991d1de00c966f102cf5',
};
// --------------------------------------------------------------------------

// Inicializamos Firebase
const app = initializeApp(firebaseConfig);

// Exportamos las herramientas para usarlas en toda la app
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Función auxiliar para iniciar sesión
export const loginWithGoogle = async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error('Error al iniciar sesión', error);
  }
};

// Función auxiliar para cerrar sesión
export const logout = () => signOut(auth);
