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

  // Page HTML en 2 étapes :
  // 1. L'utilisateur clique "Se déconnecter de Zoom" → ouvre zoom.us/logout dans un nouvel onglet
  // 2. L'utilisateur revient et clique "Connecter mon Zoom" → OAuth
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connexion Zoom - Chabbat Chalom</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
    .container { text-align: center; padding: 30px 20px; max-width: 420px; width: 100%; }
    h2 { margin-bottom: 8px; font-size: 24px; }
    .subtitle { opacity: 0.85; font-size: 14px; margin-bottom: 30px; }
    .step { background: rgba(255,255,255,0.15); border-radius: 12px; padding: 20px; margin-bottom: 16px; backdrop-filter: blur(10px); }
    .step-num { display: inline-block; width: 32px; height: 32px; line-height: 32px; border-radius: 50%; background: rgba(255,255,255,0.3); font-weight: 700; font-size: 16px; margin-bottom: 10px; }
    .step p { margin: 8px 0 14px; font-size: 14px; opacity: 0.9; }
    .btn { display: inline-block; padding: 12px 28px; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; transition: transform 0.2s, opacity 0.2s; }
    .btn:hover { transform: scale(1.03); }
    .btn-logout { background: #ff6b6b; color: white; }
    .btn-connect { background: white; color: #764ba2; }
    .btn-connect.disabled { opacity: 0.5; pointer-events: none; }
    .check { display: none; color: #69db7c; font-size: 18px; margin-top: 8px; }
    .or { font-size: 13px; opacity: 0.7; margin: 20px 0 10px; }
    .skip { font-size: 13px; opacity: 0.6; cursor: pointer; text-decoration: underline; }
    .skip:hover { opacity: 1; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Connexion Zoom</h2>
    <p class="subtitle">Connectez votre compte Zoom à votre synagogue</p>

    <div class="step">
      <div class="step-num">1</div>
      <p>D'abord, déconnectez-vous de Zoom pour pouvoir choisir votre compte :</p>
      <a href="https://zoom.us/logout" target="_blank" class="btn btn-logout" id="logoutBtn" onclick="onLogout()">Se déconnecter de Zoom</a>
      <div class="check" id="logoutCheck">✓ Déconnexion effectuée</div>
    </div>

    <div class="step">
      <div class="step-num">2</div>
      <p>Puis connectez votre compte Zoom :</p>
      <a href="${authUrl}" class="btn btn-connect disabled" id="connectBtn">Connecter mon Zoom</a>
    </div>

    <p class="or">— ou —</p>
    <span class="skip" onclick="window.location.href='${authUrl}'">Passer l'étape 1 (connexion rapide)</span>
  </div>

  <script>
    function onLogout() {
      // Après le clic sur logout, activer le bouton de connexion
      setTimeout(function() {
        document.getElementById('logoutCheck').style.display = 'block';
        document.getElementById('logoutBtn').style.opacity = '0.5';
        document.getElementById('logoutBtn').textContent = 'Déconnexion faite ✓';
        var cb = document.getElementById('connectBtn');
        cb.classList.remove('disabled');
        cb.style.animation = 'pulse 1s ease-in-out infinite';
      }, 1000);
    }
  </script>
  <style>
    @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  </style>
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
  res.json({ status: 'ok', service: 'Chabbat Chalom Zoom Proxy', mode: 'OAuth par utilisateur', version: '2.4.0-two-step-login' });
});

app.listen(PORT, () => {
  console.log(`Zoom proxy running on port ${PORT}`);
});
