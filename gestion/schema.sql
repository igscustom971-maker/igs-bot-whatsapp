-- ============================================
-- IGS GESTION - TABLES SUPABASE (phase 0)
-- À exécuter UNE fois dans Supabase > SQL Editor (projet IGS, celui de Leïla).
-- Ne touche à aucune table existante de Leïla.
-- ============================================

create table if not exists gestion_commandes (
  cle                     text primary key,      -- N° devis (ou SANS-DEVIS-client)
  n_devis                 text,
  client                  text,
  contenu_mail            text,
  email                   text,
  telephone               text,                  -- format international sans + (ex : 590690...)
  instructions            text,
  infos                   text,
  zone_flocage            text,
  affectation             text,
  planche                 text,
  statut                  text,
  date_commande           date,
  date_dynamique          boolean default false, -- true si la cellule Excel contient =TODAY()
  date_livraison          date,
  remarque                text,
  excel_id                integer,
  mail_envoye             text,
  numero_suivi            text,
  mail_expedition_envoye  text,
  mail_avis_envoye        text,
  present                 boolean default true,  -- false = ligne retirée de l'Excel (nettoyage LIVRÉE)
  synced_at               timestamptz default now(),
  created_at              timestamptz default now()
);

create index if not exists gestion_commandes_statut_idx on gestion_commandes (statut) where present;

-- Accès uniquement par le serveur (clé service_role) : RLS activée, aucune policy publique
alter table gestion_commandes enable row level security;

-- ============================================
-- AJOUT (date de livraison modifiable à la main) — à exécuter une fois
-- ============================================
alter table gestion_commandes add column if not exists date_livraison_manuelle    date;
alter table gestion_commandes add column if not exists date_livraison_modifiee_par text;
alter table gestion_commandes add column if not exists date_livraison_modifiee_le  timestamptz;

-- ============================================
-- MODULE PLANCHES DTF — à exécuter une fois
-- ============================================
create table if not exists gestion_planches (
  cle                     text primary key,      -- N° devis (ou SANS-DEVIS-client-ligne)
  n_devis                 text,
  client                  text,
  date_commande           date,
  metres                  numeric,
  format                  text,                  -- A3 / A4 (sinon métrage)
  reduction               numeric,
  montant_ht              numeric,
  frequence               text,
  hebdo                   boolean default false,
  paiement                text,
  remarques               text,
  statut                  text,
  excel_id                integer,
  mail_envoye             text,
  numero_suivi            text,
  mail_expedition_envoye  text,
  present                 boolean default true,
  synced_at               timestamptz default now(),
  created_at              timestamptz default now()
);
alter table gestion_planches enable row level security;

-- ============================================
-- PHASE 1 PLANCHES : actions, correspondances clients, réglages — à exécuter une fois
-- ============================================
create table if not exists gestion_actions (
  id           bigserial primary key,
  cree_le      timestamptz default now(),
  utilisateur  text,
  action       text,      -- planche_modifiee, devis_envoye, facture_hebdo...
  cle          text,
  details      jsonb
);
create index if not exists gestion_actions_cree_le_idx on gestion_actions (cree_le desc);

create table if not exists gestion_clients_alias (
  alias         text primary key,   -- nom Excel normalisé (ex. "zepub")
  nom_excel     text,
  partner_id    integer not null,   -- fiche client Odoo (ex. Manuel KOMLHA)
  partner_name  text,
  cree_par      text,
  updated_at    timestamptz default now()
);

create table if not exists gestion_reglages (
  cle         text primary key,
  valeur      text,
  updated_at  timestamptz default now()
);

alter table gestion_actions enable row level security;
alter table gestion_clients_alias enable row level security;
alter table gestion_reglages enable row level security;

-- ============================================
-- MODULE STOCK — à exécuter une fois
-- ============================================
create table if not exists gestion_stock_clients (
  id          bigserial primary key,
  client      text not null,        -- ex. SANDAE
  article     text,
  couleur     text,
  taille      text,
  coupe       text,
  quantite    integer not null default 0,
  note        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create table if not exists gestion_stock_mouvements (
  id           bigserial primary key,
  cree_le      timestamptz default now(),
  utilisateur  text,
  stock        text,       -- vierges / consommables / client
  client       text,
  article      text,
  avant        numeric,
  apres        numeric,
  motif        text
);
create index if not exists gestion_stock_mouvements_idx on gestion_stock_mouvements (cree_le desc);
alter table gestion_stock_clients enable row level security;
alter table gestion_stock_mouvements enable row level security;

-- ============================================
-- MODULE ESPÈCES (caisse) — à exécuter une fois
-- ============================================
create table if not exists gestion_caisse (
  id           bigserial primary key,
  cree_le      timestamptz default now(),
  type         text not null,       -- encaissement / releve
  montant      numeric not null,    -- encaissement : montant reçu ; relevé : montant récupéré
  compte       numeric,             -- relevé : espèces comptées dans la caisse
  theorique    numeric,             -- relevé : ce qui aurait dû y être
  ecart        numeric,             -- relevé : compté - théorique
  client       text,
  source       text,                -- commande / planche / autre
  ref          text,                -- N° devis ou clé planche
  note         text,
  utilisateur  text
);
create index if not exists gestion_caisse_idx on gestion_caisse (cree_le);
alter table gestion_caisse enable row level security;

-- ============================================
-- ADMIN : collaborateurs — à exécuter une fois
-- ============================================
create table if not exists gestion_collaborateurs (
  id            bigserial primary key,
  affichage     text not null,      -- nom utilisé dans "Affectation" (ex. Maureen G.)
  nom           text,
  taux_horaire  numeric,
  actif         boolean default true,
  ordre         integer default 99,
  updated_at    timestamptz default now()
);
alter table gestion_collaborateurs enable row level security;

-- Commandes : paiement à encaisser en espèces à la remise
alter table gestion_commandes add column if not exists a_payer_especes  boolean default false;
alter table gestion_commandes add column if not exists montant_especes  numeric(10,2);
alter table gestion_commandes add column if not exists especes_note_par text;

-- Commandes : bordereaux d'expédition déposés depuis le dashboard
alter table gestion_commandes add column if not exists bordereaux jsonb;

-- Heures des collaborateurs (remplace les onglets Saisie Heures / Paramètres de l'Excel)
create table if not exists gestion_heures_paiements (
  id            bigserial primary key,
  collaborateur text not null,
  semaine       text not null,          -- ex. 2026-S41
  debut         date not null,
  fin           date not null,
  minutes       integer not null,
  taux          numeric(8,2) not null,
  montant       numeric(10,2) not null,
  paye_le       timestamptz default now(),
  paye_par      text,
  note          text
);
alter table gestion_heures_paiements enable row level security;
create table if not exists gestion_heures (
  id            bigserial primary key,
  collaborateur text not null,           -- nom affiché (ex. Maureen G.)
  jour          date not null,
  minutes       integer not null check (minutes > 0),
  remarque      text,
  saisi_par     text,
  cree_le       timestamptz default now(),
  paiement_id   bigint references gestion_heures_paiements(id) on delete set null
);
create index if not exists gestion_heures_jour on gestion_heures (jour);
alter table gestion_heures enable row level security;

-- Comptes individuels des collaborateurs (connexion à distance : identifiant = prénom, mot de passe, e-mail perso)
alter table gestion_collaborateurs add column if not exists identifiant        text unique;
alter table gestion_collaborateurs add column if not exists email_perso        text;
alter table gestion_collaborateurs add column if not exists mdp_hash           text;
alter table gestion_collaborateurs add column if not exists mdp_provisoire     boolean default false;
alter table gestion_collaborateurs add column if not exists mdp_version        integer default 0;
alter table gestion_collaborateurs add column if not exists reset_hash         text;
alter table gestion_collaborateurs add column if not exists reset_expire       timestamptz;
alter table gestion_collaborateurs add column if not exists derniere_connexion timestamptz;

-- Commandes : BAT envoyé au client (en attente de validation)
alter table gestion_commandes add column if not exists bat_envoye_le  timestamptz;
alter table gestion_commandes add column if not exists bat_envoye_par text;

-- WhatsApp : heure du dernier message reçu par numéro (fenêtre de 24 h pour envoyer le BAT par WhatsApp)
create table if not exists gestion_whatsapp_entrants (
  telephone       text primary key,
  dernier_message timestamptz not null
);
alter table gestion_whatsapp_entrants enable row level security;

-- Commandes : réponse du client au BAT (message, canal, date, verdict valide / modification / autre)
alter table gestion_commandes add column if not exists bat_reponse jsonb;

-- Commandes : BAT créé automatiquement à réception du formulaire (à vérifier avant envoi)
alter table gestion_commandes add column if not exists bat_auto_le     timestamptz;
alter table gestion_commandes add column if not exists bat_auto_erreur text;

-- Commandes : alertes du BAT automatique (visuel trop grand pour la plus petite taille commandée)
alter table gestion_commandes add column if not exists bat_alertes jsonb;

-- Messages automatiques aux clients (prête / expédiée / avis, commandes et planches) + renvois de BAT par Leïla
create table if not exists gestion_notifications (
  id           bigserial primary key,
  cle          text,
  type         text,
  canal        text,
  statut       text,
  destinataire text,
  sujet        text,
  message      text,
  erreur       text,
  par          text,
  cree_le      timestamptz default now()
);
alter table gestion_notifications enable row level security;
create index if not exists gestion_notifications_cle_idx on gestion_notifications (cle);
create index if not exists gestion_notifications_cree_le_idx on gestion_notifications (cree_le desc);

-- Commandes : date à laquelle le dashboard a vu la commande en LIVRÉE (avis Google le lendemain à 10 h)
alter table gestion_commandes add column if not exists livree_vu_le timestamptz;

-- Sortie de l'Excel : stock de t-shirts vierges et consommables dans la base du dashboard
create table if not exists gestion_stock_vierges (
  id        bigserial primary key,
  reference text,
  coupe     text,
  couleur   text,
  taille    text,
  quantite  numeric default 0
);
alter table gestion_stock_vierges enable row level security;
create table if not exists gestion_stock_conso (
  id    bigserial primary key,
  nom   text,
  stock numeric default 0,
  seuil numeric
);
alter table gestion_stock_conso enable row level security;
create index if not exists gestion_commandes_present_idx on gestion_commandes (present);
create index if not exists gestion_planches_present_idx on gestion_planches (present);
