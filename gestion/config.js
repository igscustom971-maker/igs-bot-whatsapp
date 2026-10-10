// ============================================
// IGS GESTION - CONFIGURATION
// Toutes les valeurs sensibles viennent des variables d'environnement Render.
// ============================================

const list = v => (v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

module.exports = {
  // Connexion Microsoft 365 (app GHS, même tenant)
  TENANT_ID: process.env.MS_TENANT_ID,
  CLIENT_ID: process.env.MS_CLIENT_ID,
  CLIENT_SECRET: process.env.MS_CLIENT_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,

  // Rôles
  ADMIN_EMAILS: list(process.env.GESTION_ADMIN_EMAILS || 'ismael.g@ghs-connectplus.com'),
  TEAM_EMAILS: list(process.env.GESTION_TEAM_EMAILS || 'contact@igscustom.fr'),

  // Domaines autorisés pour la connexion (l'URI de retour est construite à partir du domaine utilisé)
  ALLOWED_HOSTS: list(process.env.GESTION_HOSTS || 'igs-bot-whatsapp.onrender.com,dashboard.igscustom.fr'),
  // Sur ce domaine, la racine "/" ouvre directement l'interface de gestion
  DASHBOARD_HOST: (process.env.GESTION_DASHBOARD_HOST || 'dashboard.igscustom.fr').toLowerCase(),

  // SharePoint
  SITE_ID: process.env.SP_SITE_ID,
  LIBRARY_NAME: process.env.SP_LIBRARY_NAME || 'IGS CUSTOM BAR',
  EXCEL_PATH: process.env.SP_EXCEL_PATH || '/Commun/IGS - Gestion - Commandes.xlsx',
  COMMANDES_PATH: process.env.SP_COMMANDES_PATH || '/Clients/Commandes',
  TABLE_COMMANDES: process.env.SP_TABLE_COMMANDES || 'Commandes',
  TABLE_TAILLES: process.env.SP_TABLE_TAILLES || 'LignesCommande',

  // Synchro miroir Excel -> Supabase
  SYNC_INTERVAL_MS: Number(process.env.GESTION_SYNC_MS || 2 * 60 * 1000),
};
