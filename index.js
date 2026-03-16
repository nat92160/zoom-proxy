const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// OAuth App credentials (chaque président connecte son propre Zoom)
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const ZOOM_REDIRECT_URI = process.env.ZOOM_REDIRECT_URI || 'https://chabbat-chalom-zoom.onrender.com/auth/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://chabbat-chalom.web.app';
const API_SECRET = process.env.API_SECRET || 'chabbat-chalom-zoom-2024';

app.use(cors({
  origin: [
    'https://chabbat-chalom.web.app',
    'https://chabbat-chalom.firebaseapp.com',
    'http://localhost:5000'
  ]
}));
app.use(express.json());

// =============================================
// ÉTAPE 1 : Rediriger vers Zoom OAuth
// Le président clique "Connecter mon Zoom"
// =============================================
app.get('/auth/zoom', (req, res) => {
  const { synaId } = req.query;
  if (!synaId) return res.status(400).json({ error: 'synaId requis' });

  const state = encodeURIComponent(synaId);
  const authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${ZOOM_CLIENT_ID}&redirect_uri=${encodeURIComponent(ZOOM_REDIRECT_URI)}&state=${state}`;
  res.redirect(authUrl);
});

// =============================================
// ÉTAPE 2 : Callback Zoom OAuth
// Zoom renvoie le code, on échange contre des tokens
// =============================================
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const synaId = decodeURIComponent(state || '');

  if (!code) {
    return res.redirect(`${FRONTEND_URL}?zoom_error=no_code`);
  }

  try {
    const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://zoom.us/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(ZOOM_REDIRECT_URI)}`,
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('Zoom OAuth error:', tokenData);
      return res.redirect(`${FRONTEND_URL}?zoom_error=${encodeURIComponent(tokenData.reason || 'auth_failed')}`);
    }

    // Rediriger vers le frontend avec les tokens
    const params = new URLSearchParams({
      zoom_connected: 'true',
      zoom_access_token: tokenData.access_token,
      zoom_refresh_token: tokenData.refresh_token,
      synaId: synaId,
    });

    res.redirect(`${FRONTEND_URL}?${params.toString()}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${FRONTEND_URL}?zoom_error=${encodeURIComponent(err.message)}`);
  }
});

// =============================================
// Rafraîchir un token expiré
// =============================================
app.post('/refresh-token', async (req, res) => {
  try {
    const secret = req.headers['x-api-secret'];
    if (secret !== API_SECRET) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token requis' });
    }

    const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://zoom.us/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=refresh_token&refresh_token=${refresh_token}`,
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      return res.status(401).json({ error: tokenData.reason || 'Refresh échoué' });
    }

    res.json({
      success: true,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// Créer une réunion Zoom avec le token du président
// =============================================
app.post('/create-meeting', async (req, res) => {
  try {
    const secret = req.headers['x-api-secret'];
    if (secret !== API_SECRET) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { title, duration, access_token } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Le titre est requis' });
    }
    if (!access_token) {
      return res.status(400).json({ error: 'Connectez d\'abord votre compte Zoom.' });
    }

    const meetingRes = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
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
      if (meetingRes.status === 401) {
        return res.status(401).json({ error: 'Token expiré', needRefresh: true });
      }
      return res.status(500).json({ error: meeting.message || 'Erreur Zoom' });
    }

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

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Chabbat Chalom Zoom Proxy', mode: 'OAuth par utilisateur' });
});

app.listen(PORT, () => {
  console.log(`Zoom proxy running on port ${PORT}`);
});
