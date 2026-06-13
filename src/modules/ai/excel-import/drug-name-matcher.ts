/**
 * Pre-matching utility — pure string logic, zero AI calls.
 *
 * Strategy:
 *   1. Normalize both names (uppercase, strip punctuation, collapse spaces,
 *      unify dosage-form synonyms, unify unit formats).
 *   2. Exact match on the full normalized string.
 *   3. If no exact match, try token-overlap scoring:
 *      - Extract meaningful tokens (drug name words + strength + form)
 *      - Score = matched tokens / total unique tokens
 *      - Accept as match if score ≥ threshold (0.80)
 *
 * Returns the drug_id of the best candidate, or null.
 */

export interface MatchCandidate {
    id: string;
    brand_name: string;
}

// ─── synonym maps ────────────────────────────────────────────────────────────

const FORM_SYNONYMS: Record<string, string> = {
    'tablets': 'tab',
    'tablet': 'tab',
    'tabs': 'tab',
    'tab': 'tab',
    'capsules': 'cap',
    'capsule': 'cap',
    'caps': 'cap',
    'cap': 'cap',
    'fc tabs': 'tab',
    'fc tab': 'tab',
    'fctabs': 'tab',
    'fctab': 'tab',
    'f c tabs': 'tab',
    'f c tab': 'tab',
    'coated tab': 'tab',
    'coated tabs': 'tab',
    'effervescent tab': 'eff tab',
    'effervescent tabs': 'eff tab',
    'effervescent': 'eff tab',
    'syrup': 'syrup',
    'susp': 'susp',
    'suspension': 'susp',
    'drops': 'drops',
    'oral drops': 'drops',
    'injection': 'inj',
    'inj': 'inj',
    'ampoule': 'amp',
    'ampoules': 'amp',
    'amp': 'amp',
    'vial': 'vial',
    'cream': 'cream',
    'gel': 'gel',
    'spray': 'spray',
    'lotion': 'lotion',
    'shampoo': 'shampoo',
    'soap': 'soap',
    'sachet': 'sachet',
    'sachets': 'sachet',
    'supp': 'supp',
    'suppository': 'supp',
    'suppositories': 'supp',
};

const UNIT_SYNONYMS: Record<string, string> = {
    'mcg': 'mcg',
    'μg': 'mcg',
    'microgram': 'mcg',
    'mg': 'mg',
    'milligram': 'mg',
    'g': 'g',
    'gm': 'g',
    'gram': 'g',
    'grams': 'g',
    'ml': 'ml',
    'milliliter': 'ml',
    'iu': 'iu',
    'i u': 'iu',
    'i.u': 'iu',
    'miu': 'miu',
    '%': 'pct',
};

// ─── normalizer ──────────────────────────────────────────────────────────────

function normalize(name: string): string {
    let s = name.toUpperCase();

    // remove trailing dots and parenthetical notes like "(N/A)", "(CANCELLED)"
    s = s.replace(/\([^)]*\)/g, '');

    // unify units — must come before punctuation strip
    s = s.replace(/(\d+)\s*(MG\/ML|MG|MCG|G|GM|ML|IU|I\.U\.|MIU|%)/gi, (_, num, unit) => {
        const normUnit = UNIT_SYNONYMS[unit.toLowerCase().replace(/\./g, '')] ?? unit.toLowerCase();
        return `${num}${normUnit}`;
    });

    // strip punctuation except digits, letters, spaces
    s = s.replace(/[^A-Z0-9\s]/g, ' ');

    // collapse multiple spaces
    s = s.replace(/\s+/g, ' ').trim();

    // unify dosage form synonyms (longest match first)
    const sortedForms = Object.keys(FORM_SYNONYMS).sort((a, b) => b.length - a.length);
    for (const form of sortedForms) {
        const pattern = new RegExp(`\\b${form.toUpperCase().replace(/\s+/g, '\\s+')}\\b`, 'g');
        const replacement = FORM_SYNONYMS[form].toUpperCase();
        s = s.replace(pattern, replacement);
    }

    // collapse again after replacements
    s = s.replace(/\s+/g, ' ').trim();

    return s;
}

// ─── tokenizer ───────────────────────────────────────────────────────────────

function tokenize(normalized: string): Set<string> {
    return new Set(
        normalized
            .split(/\s+/)
            .filter((t) => t.length > 1), // drop single-char noise
    );
}

// ─── scorer ──────────────────────────────────────────────────────────────────

function tokenOverlapScore(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let common = 0;
    a.forEach((t) => { if (b.has(t)) common++; });
    // Jaccard-like: intersection / union
    const union = new Set([...a, ...b]).size;
    return common / union;
}

// ─── public API ──────────────────────────────────────────────────────────────

const SCORE_THRESHOLD = 0.75;

export function preMatch(
    drugName: string,
    candidates: MatchCandidate[],
): string | null {
    if (candidates.length === 0) return null;

    const normInput = normalize(drugName);
    const tokensInput = tokenize(normInput);

    let bestId: string | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
        const normCandidate = normalize(candidate.brand_name);

        // 1. Exact match after normalization
        if (normInput === normCandidate) {
            return candidate.id;
        }

        // 2. Token overlap score
        const tokensCandidate = tokenize(normCandidate);
        const score = tokenOverlapScore(tokensInput, tokensCandidate);

        if (score > bestScore) {
            bestScore = score;
            bestId = candidate.id;
        }
    }

    return bestScore >= SCORE_THRESHOLD ? bestId : null;
}
