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
