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
// Étape 1 : Page intermédiaire qui déconnecte Zoom puis redirige vers OAuth
app.get('/auth/zoom', (req, res) => {
  const { synaId } = req.query;
  if (!synaId) return res.status(400).json({ error: 'synaId requis' });

  const state = encodeURIComponent(synaId);
  const authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${ZOOM_CLIENT_ID}&redirect_uri=${encodeURIComponent(ZOOM_REDIRECT_URI)}&state=${state}`;

  // Servir une page HTML qui :
  // 1. Ouvre zoom.us/logout dans une popup pour déconnecter la session
  // 2. Attend 2 secondes
  // 3. Redirige vers la page d'autorisation OAuth
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connexion Zoom - Chabbat Chalom</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
    .container { text-align: center; padding: 40px; }
    .spinner { width: 50px; height: 50px; border: 4px solid rgba(255,255,255,0.3); border-top: 4px solid white; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { margin-bottom: 10px; }
    p { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h2>Connexion Zoom</h2>
    <p>Déconnexion de la session précédente...</p>
    <p style="font-size: 13px; opacity: 0.7;">Redirection automatique dans quelques secondes</p>
  </div>
  <script>
    // Ouvrir la page de logout Zoom dans une popup cachée
    var logoutWin = window.open('https://zoom.us/logout', '_blank', 'width=1,height=1,left=-100,top=-100');

    // Fermer la popup après 1.5s et rediriger vers OAuth
    setTimeout(function() {
      try { if (logoutWin) logoutWin.close(); } catch(e) {}
      window.location.href = '${authUrl}';
    }, 2500);

    // Fallback: si la popup est bloquée, rediriger quand même après 3s
    setTimeout(function() {
      window.location.href = '${authUrl}';
    }, 3500);
  </script>
</body>
</html>`);
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

    const { title, duration, access_token, start_time, timezone, passcode, waiting_room, use_pmi } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Le titre est requis' });
    }
    if (!access_token) {
      return res.status(400).json({ error: 'Connectez d\'abord votre compte Zoom.' });
    }

    // Fuseau horaire (par défaut Europe/Paris)
    const tz = timezone || 'Europe/Paris';

    // Construire le body Zoom
    const meetingBody = {
      topic: title,
      type: use_pmi ? 1 : 2, // 1 = instant avec PMI, 2 = scheduled
      duration: duration || 60,
      timezone: tz,
      settings: {
        host_video: true,
        participant_video: false,
        join_before_host: true,
        mute_upon_entry: true,
        waiting_room: waiting_room || false,
        auto_recording: 'none',
      },
    };

    // Code secret personnalisé
    if (passcode) {
      meetingBody.password = passcode;
    }

    // Utiliser l'ID de réunion personnel
    if (use_pmi) {
      meetingBody.settings.use_pmi = true;
    }

    // Si start_time fourni, formater pour Zoom (YYYY-MM-DDTHH:mm:ss sans Z)
    if (start_time) {
      // Nettoyer le start_time : garder uniquement YYYY-MM-DDTHH:mm:ss
      let cleanTime = start_time.replace('Z', '');
      // Si format datetime-local (YYYY-MM-DDTHH:mm), ajouter :00
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cleanTime)) {
        cleanTime += ':00';
      }
      meetingBody.start_time = cleanTime;
      meetingBody.type = 2; // Toujours scheduled si date programmée
      console.log('Scheduling meeting at:', cleanTime, 'timezone:', tz);
    }

    const meetingRes = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(meetingBody),
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
      start_time: meeting.start_time || null,
    });
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Chabbat Chalom Zoom Proxy', mode: 'OAuth par utilisateur', version: '2.2.0-force-login' });
});

app.listen(PORT, () => {
  console.log(`Zoom proxy running on port ${PORT}`);
});
