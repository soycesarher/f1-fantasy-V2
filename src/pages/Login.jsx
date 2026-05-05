// src/pages/Login.jsx
import React, { useState } from 'react';
import { loginWithGoogle } from '../firebase';

export default function Login({ requireCode, onCodeSuccess, onCancel }) {
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');

  const handleVerifyCode = () => {
    // Convertimos a mayúsculas y quitamos espacios para evitar errores de tipeo
    if (code.trim().toUpperCase() === 'DTMEX') {
      setCodeError('');
      onCodeSuccess(); // Le avisa a App.jsx que lo deje pasar
    } else {
      setCodeError('Código incorrecto. Acceso denegado.');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.iconContainer}>🏎️</div>

        <h1 style={styles.title}>
          <span style={{ color: '#e10600' }}>F1</span> QUINIELA 2026
        </h1>

        {/* SI NO REQUIERE CÓDIGO, MOSTRAMOS EL LOGIN NORMAL */}
        {!requireCode ? (
          <>
            <p style={styles.subtitle}>Ingresa para seleccionar a tus pilotos.</p>
            <button onClick={loginWithGoogle} style={styles.button}>
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google Logo"
                style={styles.googleIcon}
              />
              Ingresar con Google
            </button>
          </>
        ) : (
          /* SI REQUIERE CÓDIGO, MOSTRAMOS LA ENTRADA VIP */
          <>
            <p style={{ ...styles.subtitle, color: '#e10600', fontWeight: 'bold' }}>
              🔒 Liga Privada
            </p>
            <p style={{ fontSize: '0.9rem', color: '#555', marginBottom: '15px' }}>
              Si estas viendo esto es porque <strong>ingresaste con un correo diferente</strong> o porque no eres parte del grupo. Ingresa el código de invitación para unirte a la quiniela.
            </p>

            {codeError && (
              <div style={{ color: '#dc3545', marginBottom: '10px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                🚫 {codeError}
              </div>
            )}

            <input
              type="text"
              placeholder="CÓDIGO SECRETO"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #ccc',
                marginBottom: '15px',
                fontSize: '1rem',
                textAlign: 'center',
                textTransform: 'uppercase',
                boxSizing: 'border-box',
                fontWeight: 'bold',
                letterSpacing: '2px'
              }}
            />

            <button
              onClick={handleVerifyCode}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#1a1a1a',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 'bold',
                cursor: 'pointer',
                marginBottom: '10px'
              }}
            >
              Verificar Código
            </button>

            <button
              onClick={onCancel}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                cursor: 'pointer',
                textDecoration: 'underline',
                fontSize: '0.85rem'
              }}
            >
              Cancelar y salir
            </button>
          </>
        )}

        <div style={styles.footer}>Temporada Oficial 2026</div>
      </div>
    </div>
  );
}

const styles = {
  // ... el resto de tus estilos se mantienen exactamente igual
  container: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #101010 0%, #1a1a1a 50%, #e10600 100%)',
    fontFamily: "'Segoe UI', Roboto, sans-serif",
  },
  card: {
    backgroundColor: 'white',
    padding: '40px 30px',
    borderRadius: '20px',
    boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
    textAlign: 'center',
    maxWidth: '400px',
    width: '90%',
  },
  iconContainer: {
    fontSize: '3rem',
    marginBottom: '10px',
  },
  title: {
    margin: '0 0 10px 0',
    fontSize: '2rem',
    fontWeight: '900',
    color: '#1a1a1a',
  },
  subtitle: {
    color: '#666',
    margin: '0 0 25px 0',
    fontSize: '1rem',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    padding: '12px',
    backgroundColor: 'white',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
    transition: 'all 0.2s',
  },
  googleIcon: {
    width: '24px',
    height: '24px',
    marginRight: '10px',
  },
  footer: {
    marginTop: '25px',
    fontSize: '0.8rem',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
};
