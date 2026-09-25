# IGS Bot WhatsApp

Serveur qui reçoit les messages clients via Dualhook (WhatsApp Coexistence), répond avec Claude API selon le persona IGS Custom Bar, et prépare un récap pour Ismaël.

## Déploiement sur Render (gratuit)

1. Crée un compte sur render.com si pas déjà fait
2. Pousse ce dossier sur un repo GitHub (ou upload direct si Render le propose)
3. Sur Render : **New > Web Service**
4. Connecte ton repo GitHub
5. Render détecte Node.js automatiquement :
   - Build Command: `npm install`
   - Start Command: `npm start`
6. Dans **Environment**, ajoute toutes les variables du fichier `.env.example` avec tes vraies valeurs
7. Clique **Deploy**
8. Une fois déployé, tu obtiens une URL du style : `https://igs-bot-whatsapp.onrender.com`

## Configuration dans Dualhook

- **Webhook URL** : `https://ton-url-render.onrender.com/webhook`
- **Verify Token** : la même valeur que `DUALHOOK_VERIFY_TOKEN` dans tes variables d'environnement Render

## Ce qui reste à faire avant le lancement (1er octobre)

- [ ] Récupérer une clé API Claude sur console.anthropic.com
- [ ] Terminer la connexion Coexistence sur Dualhook (scan QR) pour récupérer `WHATSAPP_ACCESS_TOKEN` et `WHATSAPP_PHONE_NUMBER_ID`
- [ ] Brancher un vrai service d'envoi d'email (Resend, SendGrid, ou Nodemailer + Gmail) — actuellement le récap s'affiche juste dans les logs Render
- [ ] Tester en conditions réelles avec un numéro de test
- [ ] Configurer l'activation du bot uniquement lundi matin + mercredi matin (pour l'instant il répond tout le temps — à ajouter : vérification jour/heure avant de répondre)
