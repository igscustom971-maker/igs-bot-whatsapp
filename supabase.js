// ============================================
// IGS BOT - MODULE SUPABASE
// Historique de conversation (100 derniers messages), prénoms clients,
// notes de contexte, réglages persistants (survivent aux redéploiements)
// ============================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
} else {
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_KEY non configurées : historique et notes désactivés');
}

const HISTORY_LIMIT = 100;

// Récupère la limite d'historique propre à un client (ex: 200 pour un client importé),
// ou null si aucune limite spécifique n'est définie (on utilisera la limite par défaut)
async function getHistoryLimit(phoneNumber) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('clients')
    .select('history_limit')
    .eq('phone_number', phoneNumber)
    .maybeSingle();
  if (error) {
    console.error('Supabase getHistoryLimit erreur:', error.message);
    return null;
  }
  return data?.history_limit || null;
}

// Définit une limite d'historique propre à un client (utilisé après un import manuel)
async function setHistoryLimit(phoneNumber, limit) {
  if (!supabase) return;
  const { error } = await supabase
    .from('clients')
    .upsert({ phone_number: phoneNumber, history_limit: limit, updated_at: new Date().toISOString() });
  if (error) console.error('Supabase setHistoryLimit erreur:', error.message);
}

// Insère plusieurs messages d'un coup (import d'un historique exporté WhatsApp)
async function bulkAppendMessages(phoneNumber, messages) {
  if (!supabase || messages.length === 0) return;
  const rows = messages.map(m => ({ phone_number: phoneNumber, role: m.role, content: m.content }));
  const { error } = await supabase.from('conversations').insert(rows);
  if (error) console.error('Supabase bulkAppendMessages erreur:', error.message);
}

// Récupère les N derniers messages d'un client, triés du plus ancien au plus récent
// (format { role, content } directement utilisable par l'API Claude)
async function getHistory(phoneNumber, limit = HISTORY_LIMIT) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('conversations')
    .select('role, content, created_at')
    .eq('phone_number', phoneNumber)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Supabase getHistory erreur:', error.message);
    return [];
  }
  // Filet de sécurité : l'API Claude refuse tout message au contenu vide, et exige une
  // alternance stricte user/assistant (protège contre d'anciennes données importées)
  const cleaned = data
    .reverse()
    .map(row => ({ role: row.role, content: row.content }))
    .filter(m => m.content && m.content.trim().length > 0);
  const collapsed = collapseConsecutiveRoles(cleaned);
  // L'API Claude exige que la conversation commence par un message "user" (peut arriver si la
  // fenêtre de 100/200 messages démarre sur une réponse de l'équipe, ou si l'équipe a écrit en premier)
  while (collapsed.length > 0 && collapsed[0].role !== 'user') collapsed.shift();
  return collapsed;
}

// Fusionne les messages consécutifs de même rôle (l'API Claude exige une alternance stricte)
function collapseConsecutiveRoles(messages) {
  const result = [];
  for (const m of messages) {
    const last = result[result.length - 1];
    if (last && last.role === m.role) {
      last.content += '\n' + m.content;
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

// Ajoute un message à l'historique d'un client
async function appendMessage(phoneNumber, role, content) {
  if (!supabase) return;
  const { error } = await supabase
    .from('conversations')
    .insert({ phone_number: phoneNumber, role, content });
  if (error) console.error('Supabase appendMessage erreur:', error.message);
}

// Horodatage (ms) du dernier message "assistant" (bot OU réponse manuelle d'Ismaël, échos inclus)
async function getLastAssistantAt(phoneNumber) {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from('conversations')
    .select('created_at')
    .eq('phone_number', phoneNumber)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('Supabase getLastAssistantAt erreur:', error.message);
    return 0;
  }
  return data?.created_at ? new Date(data.created_at).getTime() : 0;
}

// Récupère le prénom connu d'un client (ou null)
async function getClientName(phoneNumber) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('clients')
    .select('name')
    .eq('phone_number', phoneNumber)
    .maybeSingle();
  if (error) {
    console.error('Supabase getClientName erreur:', error.message);
    return null;
  }
  return data?.name || null;
}

// Enregistre/maj le prénom d'un client
async function upsertClientName(phoneNumber, name) {
  if (!supabase) return;
  const { error } = await supabase
    .from('clients')
    .upsert({ phone_number: phoneNumber, name, updated_at: new Date().toISOString() });
  if (error) console.error('Supabase upsertClientName erreur:', error.message);
}

// Récupère la note de contexte d'un client (ou chaîne vide)
async function getClientNote(phoneNumber) {
  if (!supabase) return '';
  const { data, error } = await supabase
    .from('client_notes')
    .select('note')
    .eq('phone_number', phoneNumber)
    .maybeSingle();
  if (error) {
    console.error('Supabase getClientNote erreur:', error.message);
    return '';
  }
  return data?.note || '';
}

// Enregistre/maj la note de contexte d'un client (depuis le panel)
async function upsertClientNote(phoneNumber, note) {
  if (!supabase) return;
  const { error } = await supabase
    .from('client_notes')
    .upsert({ phone_number: phoneNumber, note, updated_at: new Date().toISOString() });
  if (error) console.error('Supabase upsertClientNote erreur:', error.message);
}

// Lit un réglage général (clé/valeur)
async function getSetting(key) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('bot_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.error('Supabase getSetting erreur:', error.message);
    return null;
  }
  return data?.value ?? null;
}

// Écrit un réglage général (depuis le panel)
async function setSetting(key, value) {
  if (!supabase) return;
  const { error } = await supabase
    .from('bot_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) console.error('Supabase setSetting erreur:', error.message);
}

// Liste les numéros ayant eu au moins un message (client ou équipe) depuis une date donnée.
// Utilisé pour repérer les clients gérés manuellement par l'équipe l'après-midi (via écho),
// afin de les inclure dans le récap du lendemain matin.
async function getPhoneNumbersActiveSince(isoTimestamp) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('conversations')
    .select('phone_number')
    .gte('created_at', isoTimestamp);
  if (error) {
    console.error('Supabase getPhoneNumbersActiveSince erreur:', error.message);
    return [];
  }
  return [...new Set(data.map(row => row.phone_number))];
}

module.exports = {
  getHistory,
  getLastAssistantAt,
  appendMessage,
  getClientName,
  upsertClientName,
  getClientNote,
  upsertClientNote,
  getSetting,
  setSetting,
  getHistoryLimit,
  setHistoryLimit,
  bulkAppendMessages,
  getPhoneNumbersActiveSince,
};
