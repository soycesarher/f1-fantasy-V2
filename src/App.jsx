// src/App.jsx
import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Esto vigila si el usuario inicia o cierra sesión
    const unsubscribe = onAuthStateChanged(auth, (usuarioFirebase) => {
      setUser(usuarioFirebase);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) return <h2>Cargando motores... 🏎️</h2>;

  return (
    <div>
      {user ? <Dashboard /> : <Login />}
    </div>
  );
}

export default App;