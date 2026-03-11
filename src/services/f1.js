// src/services/f1.js

// Función auxiliar para obtener la última sesión de carrera disponible
async function getLatestSession() {
  try {
    // Buscamos sesiones de tipo "Race" (Carrera), ordenadas por fecha descendente
    const response = await fetch(
      'https://api.openf1.org/v1/sessions?session_name=Race&n=1'
    );
    const data = await response.json();

    // Si encontramos una, devolvemos su key, si no, usamos una de respaldo (Bahrain 2024)
    return data.length > 0 ? data[0].session_key : 9472;
  } catch (error) {
    console.error('Error buscando sesión:', error);
    return 9472; // Fallback
  }
}

export async function getDrivers() {
  try {
    // 1. Obtenemos la llave de la carrera más reciente automáticamente
    const sessionKey = await getLatestSession();
    console.log(`Cargando pilotos de la sesión: ${sessionKey}`);

    // 2. Pedimos los pilotos de esa carrera específica
    const response = await fetch(
      `https://api.openf1.org/v1/drivers?session_key=${sessionKey}`
    );
    const data = await response.json();

    // 3. Limpiamos duplicados (igual que antes)
    const uniqueDrivers = [];
    const seen = new Set();

    data.forEach((driver) => {
      if (
        driver.full_name &&
        driver.driver_number &&
        !seen.has(driver.driver_number)
      ) {
        seen.add(driver.driver_number);
        uniqueDrivers.push({
          id: driver.driver_number,
          name: driver.full_name,
          team: driver.team_name,
          color: `#${driver.team_colour}`,
          image: driver.headshot_url,
        });
      }
    });

    return uniqueDrivers;
  } catch (error) {
    console.error('Error buscando pilotos:', error);
    return [];
  }
}
