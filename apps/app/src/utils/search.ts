/**
 * Fuzzy search with synonym support for electrical terminology
 * Handles common synonyms and variations in Dutch, French, and English
 */

/**
 * Synonym mappings for electrical terms
 * Maps common terms (including old/non-standard) to their standard equivalents
 */
const synonymMap: Record<string, string[]> = {
  // Dutch synonyms
  'stopcontact': ['contactdoos', 'stopcontact', 'socket', 'outlet'],
  'contactdoos': ['contactdoos', 'stopcontact', 'socket', 'outlet'],
  'beveiliging': ['beveiligingstoestel', 'beveiliging', 'protection', 'dispositif'],
  'beveiligingstoestel': ['beveiligingstoestel', 'beveiliging', 'protection', 'dispositif'],
  'beveiligingsschakelaar': ['beveiligingsschakelaar', 'automaat', 'automatische schakelaar', 'disjoncteur', 'mcb', 'circuit breaker', 'protection switch'],
  'schakelaar': ['schakelaar', 'interrupteur', 'switch'],
  'lichtpunt': ['lichtpunt', 'point lumineux', 'light point', 'lamp'],
  'verdeelbord': ['verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'hoofdbord', 'subbord', 'zekeringkast', 'kast', 'coffret'],
  'hoofdbord': ['hoofdbord', 'verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'main panel'],
  'subbord': ['subbord', 'verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'sub panel'],
  'zekeringkast': ['zekeringkast', 'kast', 'verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'coffret', 'fuse box'],
  'kast': ['kast', 'zekeringkast', 'verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'coffret'],
  'vast toestel': ['vast toestel', 'appareil fixe', 'fixed appliance'],
  'differentieelschakelaar': ['differentieelschakelaar', 'disjoncteur différentiel', 'rcd', 'residual current device'],
  'automaat': ['automaat', 'automatische schakelaar', 'beveiligingsschakelaar', 'disjoncteur', 'mcb', 'circuit breaker'],
  'automatische schakelaar': ['automaat', 'automatische schakelaar', 'beveiligingsschakelaar', 'disjoncteur', 'mcb', 'circuit breaker'],
  'differentieelautomaat': ['differentieelautomaat', 'disjoncteur différentiel combiné', 'rcbo'],
  'zekering': ['zekering', 'smeltveiligheid', 'fusible', 'fuse'],
  'smeltveiligheid': ['smeltveiligheid', 'zekering', 'fusible', 'fuse'],
  // Heating / HVAC / appliances (Dutch core terms)
  'verwarming': ['verwarming', 'chauffage', 'heating', 'radiator', 'accumulatieverwarming', 'kachel', 'convector', 'vloerverwarming'],
  'accumulatieverwarming': ['accumulatieverwarming', 'verwarming', 'chauffage', 'accumulation heating'],
  'vloerverwarming': ['vloerverwarming', 'verwarming', 'chauffage', 'underfloor heating'],
  'kachel': ['kachel', 'verwarming', 'chauffage', 'stove', 'heater'],
  'radiator': ['radiator', 'verwarming', 'chauffage', 'heating'],
  'boiler': ['boiler', 'elektrische boiler', 'chauffe-eau', 'water heater'],
  'fornuis': ['fornuis', 'cuisinière', 'stove', 'kookplaat', 'taque', 'cooker', 'hob'],
  'kookplaat': ['kookplaat', 'fornuis', 'cuisinière', 'stove', 'taque', 'cooker', 'hob'],
  
  // French synonyms
  'prise': ['prise de courant', 'prise', 'contactdoos', 'stopcontact', 'socket', 'outlet'],
  'prise de courant': ['prise de courant', 'prise', 'contactdoos', 'stopcontact', 'socket', 'outlet'],
  'interrupteur': ['interrupteur', 'schakelaar', 'switch'],
  'point lumineux': ['point lumineux', 'lichtpunt', 'light point', 'lamp'],
  'tableau de distribution': ['tableau de distribution', 'verdeelbord', 'distribution board', 'panel', 'hoofdbord', 'subbord', 'zekeringkast', 'kast', 'coffret', 'tableau électrique'],
  'tableau électrique': ['tableau électrique', 'tableau de distribution', 'verdeelbord', 'distribution board', 'panel', 'coffret'],
  'coffret': ['coffret', 'tableau de distribution', 'verdeelbord', 'distribution board', 'panel', 'zekeringkast', 'kast', 'tableau électrique'],
  'appareil fixe': ['appareil fixe', 'vast toestel', 'fixed appliance'],
  'dispositif de protection': ['dispositif de protection', 'beveiligingstoestel', 'beveiliging', 'protection'],
  'disjoncteur différentiel': ['disjoncteur différentiel', 'differentieelschakelaar', 'rcd', 'residual current device'],
  'disjoncteur': ['disjoncteur', 'automaat', 'automatische schakelaar', 'beveiligingsschakelaar', 'mcb', 'circuit breaker'],
  'disjoncteur différentiel combiné': ['disjoncteur différentiel combiné', 'differentieelautomaat', 'rcbo'],
  'fusible': ['fusible', 'zekering', 'smeltveiligheid', 'fuse'],
  // Heating / HVAC / appliances (French core terms)
  'chauffage': ['chauffage', 'verwarming', 'heating', 'radiator', 'convecteur', 'accumulation', 'plancher chauffant'],
  'convecteur': ['convecteur', 'radiateur', 'chauffage', 'verwarming', 'heater'],
  'plancher chauffant': ['plancher chauffant', 'chauffage', 'verwarming', 'underfloor heating', 'vloerverwarming'],
  'cuisinière': ['cuisinière', 'fornuis', 'stove', 'kookplaat', 'taque', 'cooker', 'hob'],
  'taque': ['taque', 'cuisinière', 'fornuis', 'stove', 'kookplaat', 'cooker', 'hob'],
  'chauffe-eau': ['chauffe-eau', 'boiler', 'water heater', 'chauffe-eau électrique'],
  
  // English synonyms
  'socket': ['socket', 'outlet', 'contactdoos', 'stopcontact', 'prise', 'prise de courant'],
  'outlet': ['outlet', 'socket', 'contactdoos', 'stopcontact', 'prise', 'prise de courant'],
  'switch': ['switch', 'schakelaar', 'interrupteur'],
  'light point': ['light point', 'lichtpunt', 'point lumineux', 'lamp'],
  'distribution board': ['distribution board', 'verdeelbord', 'tableau de distribution', 'panel', 'hoofdbord', 'subbord', 'zekeringkast', 'kast', 'coffret', 'tableau électrique', 'fuse box'],
  'panel': ['panel', 'verdeelbord', 'tableau de distribution', 'distribution board', 'hoofdbord', 'subbord', 'zekeringkast', 'kast', 'coffret', 'tableau électrique'],
  'fuse box': ['fuse box', 'zekeringkast', 'kast', 'verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'coffret'],
  'fixed appliance': ['fixed appliance', 'vast toestel', 'appareil fixe'],
  'protection': ['protection', 'beveiligingstoestel', 'beveiliging', 'dispositif de protection'],
  'protection switch': ['protection switch', 'beveiligingsschakelaar', 'automaat', 'automatische schakelaar', 'disjoncteur', 'mcb', 'circuit breaker'],
  'rcd': ['rcd', 'differentieelschakelaar', 'disjoncteur différentiel', 'residual current device'],
  'mcb': ['mcb', 'automaat', 'automatische schakelaar', 'beveiligingsschakelaar', 'disjoncteur', 'circuit breaker'],
  'rcbo': ['rcbo', 'differentieelautomaat', 'disjoncteur différentiel combiné'],
  'fuse': ['fuse', 'zekering', 'smeltveiligheid', 'fusible'],
  // Heating / HVAC / appliances (English core terms)
  'heating': ['heating', 'verwarming', 'chauffage', 'radiator', 'heater', 'space heater'],
  'heater': ['heater', 'heating', 'verwarming', 'chauffage', 'radiator'],
  'underfloor heating': ['underfloor heating', 'vloerverwarming', 'plancher chauffant'],
  'stove': ['stove', 'fornuis', 'cuisinière', 'kookplaat', 'taque', 'cooker', 'hob'],
  'hob': ['hob', 'cooktop', 'stove', 'kookplaat', 'taque', 'fornuis', 'cuisinière'],
  'cooktop': ['cooktop', 'hob', 'stove', 'kookplaat', 'taque', 'fornuis', 'cuisinière'],
  'water heater': ['water heater', 'boiler', 'chauffe-eau', 'electric boiler'],

  // Common transliteration / slang we still want to match
  'shufaas': ['shufaas', 'chauffage', 'heating', 'verwarming'],
}

/**
 * Normalize search query - lowercase and trim
 */
function normalizeQuery(query: string): string {
  return query.toLowerCase().trim()
}

/**
 * Get all synonyms for a given term
 */
function getSynonyms(term: string): string[] {
  const normalized = normalizeQuery(term)
  // Also check if any synonym map contains this term
  const allSynonyms = new Set<string>([normalized])
  for (const [, values] of Object.entries(synonymMap)) {
    if (values.includes(normalized)) {
      values.forEach(v => allSynonyms.add(v))
    }
  }
  return Array.from(allSynonyms)
}

/**
 * Expand search query with synonyms
 */
export function expandSearchQuery(query: string): string[] {
  if (!query) return []
  
  const normalized = normalizeQuery(query)
  const words = normalized.split(/\s+/)
  
  // Get synonyms for each word
  const expandedTerms = new Set<string>()
  
  // Add the original query
  expandedTerms.add(normalized)
  
  // Add synonyms for individual words
  words.forEach(word => {
    const synonyms = getSynonyms(word)
    synonyms.forEach(syn => expandedTerms.add(syn))
  })
  
  // Also try to match multi-word terms
  if (words.length > 1) {
    const fullPhrase = words.join(' ')
    const phraseSynonyms = getSynonyms(fullPhrase)
    phraseSynonyms.forEach(syn => expandedTerms.add(syn))
  }
  
  return Array.from(expandedTerms)
}

/**
 * Check if text matches any of the search terms (with synonyms)
 */
export function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true
  
  const normalizedText = normalizeQuery(text)
  const searchTerms = expandSearchQuery(query)
  
  // Check if any search term is contained in the text
  return searchTerms.some(term => normalizedText.includes(term))
}

/**
 * Check if any of the provided texts match the query
 */
export function fuzzyMatchAny(texts: string[], query: string): boolean {
  if (!query) return true
  return texts.some(text => fuzzyMatch(text, query))
}
