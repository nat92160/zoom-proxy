const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIG ---
const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
// Clé secrète pour sécuriser les appels (à mettre aussi dans le frontend)
const API_SECRET = process.env.API_SECRET || 'chabbat-chalom-zoom-2024';

// CORS : accepter uniquement ton app
app.use(cors({
  origin: [
    'https://chabbat-chalom.web.app',
    'https://chabbat-chalom.firebaseapp.com',
    'http://localhost:5000'
  ]
}));
app.use(express.json());

// --- Obtenir un token Zoom OAuth ---
async function getZoomToken() {
  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');

  const res = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Zoom OAuth: ${data.reason || data.error || 'Erreur'}`);
  return data.access_token;
}

// --- ROUTE : Créer une réunion Zoom ---
app.post('/create-meeting', async (req, res) => {
  try {
    // Vérifier la clé secrète
    const secret = req.headers['x-api-secret'];
    if (secret !== API_SECRET) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { title, duration } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Le titre est requis' });
    }

    // 1. Token Zoom
    const token = await getZoomToken();

    // 2. Créer la réunion
    const meetingRes = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: title,
        type: 2,
        duration: duration || 60,
        timezone: 'Europe/Paris',
        settings: {
          host_video: true,
          participant_video: false,
          join_before_host: true,
          mute_upon_entry: true,
          waiting_room: false,
          auto_recording: 'none',
        },
      }),
    });

    const meeting = await meetingRes.json();

    if (!meetingRes.ok) {
      console.error('Zoom API error:', meeting);
      return res.status(500).json({ error: meeting.message || 'Erreur Zoom' });
    }

    // 3. Renvoyer les infos essentielles
    res.json({
      success: true,
      joinUrl: meeting.join_url,
      startUrl: meeting.start_url,
      meetingId: String(meeting.id),
      password: meeting.password || '',
      topic: meeting.topic,
    });

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Health check ---
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Chabbat Chalom Zoom Proxy' });
});

app.listen(PORT, () => {
  console.log(`Zoom proxy running on port ${PORT}`);
});
