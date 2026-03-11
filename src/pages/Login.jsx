// src/pages/Login.jsx
import React from 'react';
import { loginWithGoogle } from '../firebase';

export default function Login() {
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Icono decorativo - Un poco más pequeño */}
        <div style={styles.iconContainer}>🏎️</div>

        {/* Título con F1 en ROJO */}
        <h1 style={styles.title}>
          <span style={{ color: '#e10600' }}>F1</span> FANTASY 2026
        </h1>

        <p style={styles.subtitle}>Ingresa para seleccionar a tus pilotos.</p>

        <button onClick={loginWithGoogle} style={styles.button}>
          {/* URL OFICIAL DE GOOGLE */}
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google Logo"
            style={styles.googleIcon}
          />
          Ingresar con Google
        </button>

        <div style={styles.footer}>Temporada Oficial 2026</div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    // CAMBIO CLAVE: position fixed asegura que cubra TODO sin bordes blancos
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Fondo degradado elegante (Rojo F1 a Oscuro)
    background:
      'linear-gradient(135deg, #101010 0%, #1a1a1a 50%, #e10600 100%)',
    fontFamily: "'Segoe UI', Roboto, sans-serif",
    zIndex: 9999, // Asegura que esté encima de todo
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    // CAMBIO: Menos padding para que no se vea gigante en celular
    padding: '30px 20px',
    borderRadius: '20px', // Bordes un poco menos redondos para ahorrar espacio
    boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
    textAlign: 'center',
    // CAMBIO: Ancho máximo un poco más angosto para elegancia
    maxWidth: '360px',
    width: '85%', // Deja margen a los lados en cels muy pequeños
    backdropFilter: 'blur(10px)',
  },
  iconContainer: {
    fontSize: '2.5rem', // Reducido de 3rem
    marginBottom: '5px',
  },
  title: {
    margin: '0 0 8px 0',
    color: '#111',
    fontSize: '1.8rem', // Reducido de 2rem para que quepa en una línea en cels
    fontWeight: '900',
    letterSpacing: '-1px',
    textTransform: 'uppercase',
    fontStyle: 'italic',
  },
  subtitle: {
    color: '#666',
    margin: '0 0 25px 0',
    lineHeight: '1.4',
    fontSize: '0.95rem', // Letra un pelín más chica
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    width: '100%',
    padding: '12px', // Botón un poco más compacto
    backgroundColor: '#fff',
    border: '2px solid #e1e1e1',
    borderRadius: '10px',
    fontSize: '0.95rem',
    fontWeight: '600',
    color: '#333',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
  },
  googleIcon: {
    width: '20px',
    height: '20px',
  },
  footer: {
    marginTop: '20px',
    fontSize: '0.7rem',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
};
