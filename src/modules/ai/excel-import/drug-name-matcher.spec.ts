import { preMatch } from './drug-name-matcher';

const c = (brand_name: string) => [{ id: 'test-id', brand_name }];

describe('preMatch — drug name normalizer', () => {
    // ── should match ────────────────────────────────────────────────────────────
    it('Amlodipine 10mg 20 tab → AMLODIPINE 10MG 20 TABS.', () =>
        expect(preMatch('Amlodipine 10mg 20 tab', c('AMLODIPINE 10MG 20 TABS.'))).toBe('test-id'));

    it('Amlodipine 5mg 30 tab → AMLODIPINE 5 MG 30 TAB.', () =>
        expect(preMatch('Amlodipine 5mg 30 tab', c('AMLODIPINE 5 MG 30 TAB.'))).toBe('test-id'));

    it('Abilify 5mg 10 tab → ABILIFY 5 MG 10 TABS.', () =>
        expect(preMatch('Abilify 5mg 10 tab', c('ABILIFY 5 MG 10 TABS.'))).toBe('test-id'));

    it('Aricept 5mg 14 tab → ARICEPT 5 MG 14 TABS.', () =>
        expect(preMatch('Aricept 5mg 14 tab', c('ARICEPT 5 MG 14 TABS.'))).toBe('test-id'));

    it('Atacand 4mg 14 tab → ATACAND 4MG 14 TAB.', () =>
        expect(preMatch('Atacand 4mg 14 tab', c('ATACAND 4MG 14 TAB.'))).toBe('test-id'));

    it('Allertam 120mg 10 tab → ALLERTAM 120 MG 10 F.C.TABS.', () =>
        expect(preMatch('Allertam 120mg 10 tab', c('ALLERTAM 120 MG 10 F.C.TABS.'))).toBe('test-id'));

    it('Ambroxol 15ml Oral Drops → AMBROXOL 7.5MG/ML ORAL DROPS 15 ML', () =>
        expect(preMatch('Ambroxol 15ml Oral Drops', c('AMBROXOL 7.5MG/ML ORAL DROPS 15 ML'))).toBe('test-id'));

    it('Albendazole 30ml Syrup — different strength format goes to AI (not pre-matched)', () =>
        expect(preMatch('Albendazole 30ml Syrup', c('ALBENDAZOLE 200MG/5ML SUSP. 30 ML'))).toBeNull());

    // ── should NOT match ────────────────────────────────────────────────────────
    it('Amlodipine 10mg should NOT match Amlodipine 5mg', () =>
        expect(preMatch('Amlodipine 10mg 20 tab', c('AMLODIPINE 5 MG 30 TAB.'))).toBeNull());

    it('different drug entirely should NOT match', () =>
        expect(preMatch('Panadol 500mg 20 tab', c('AMLODIPINE 10MG 20 TABS.'))).toBeNull());

    it('empty candidates returns null', () =>
        expect(preMatch('Amlodipine 10mg 20 tab', [])).toBeNull());
});
