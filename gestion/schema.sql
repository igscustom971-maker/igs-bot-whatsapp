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
