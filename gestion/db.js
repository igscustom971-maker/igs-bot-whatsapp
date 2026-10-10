// ============================================
// IGS GESTION - CLIENT SUPABASE (même projet que Leïla, tables préfixées gestion_)
// ============================================
const { createClient } = require('@supabase/supabase-js');

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;
if (!supabase) console.warn('Gestion : Supabase non configuré, le miroir des commandes reste en mémoire');

module.exports = { supabase };
