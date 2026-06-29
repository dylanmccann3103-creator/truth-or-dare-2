# Genitals backfill — human review

This file lists cards where `performerGenitals` / `targetGenitals` were left `null`
**deliberately** because the act is sexual/explicit and a body-part requirement is
plausible, but the card text was too ambiguous to infer the exact part conservatively
(per the safety-critical filter rule: any doubt → null).

Only ambiguous explicit/sexual cards are listed. Cards that clearly need no genitals
(level 1–4 general/flirty/truth/kissing/massage, duels, talk cards) are omitted.

Vocabulary reminder: only `penis`, `vagina`, `breasts`, `anus`. No "mouth" — oral is the
`oral` tag, not a genitals value.

---

## data/dares.json

| Card | Text (EN/NL) | Why ambiguous / human decision |
|------|--------------|--------------------------------|
| d048 | "Wikkel je partner strak in folie ... Schuif een vibrerend speeltje tussen hun benen ..." | "between their legs" — gender-neutral, no organ named. Could be vulva or perineum/scrotum. Decide receiver part. |
| d049 | "Laat je partner ... Prikkel ze door hun geslachtsdelen te kussen, likken en zuigen ..." | Generic "geslachtsdelen" (genitals) — no specific anatomy named. Could be penis or vagina. |
| d050 | "Geef je partner orale seks tot ze beginnen te kreunen ..." | Generic oral, no anatomy named. |
| d062 | "Geef je partner orale seks terwijl je ze tegelijkertijd intern stimuleert met vingers. Gebruik een 'kom hier'-beweging ..." | "Come hither" internal stimulation suggests G-spot (vagina) but never named; gender-neutral, could also be prostate (anus). |
| d069 | "Blinddoek en beperk je partner ... verken elk stukje ... met alleen je mond ..." | Whole-body oral teasing, no specific organ required. |
| d070 | "Breng je partner oraal naar de rand van een orgasme ..." | Generic oral edging, no anatomy named. |
| d072 | "Stel een sessie met meerdere speeltjes in ... Combineer oraal, vingers en speeltjes ..." | Generic oral/toy play, no organ named. |
| d077 | "Face-sitting sessie ... De onderste gebruikt alleen mond en tong totdat hun partner klaarkomt." | Face-sitting / oral — receiver organ not specified; could be vulva, penis, or anus. |
| d078 | "Uitgebreide edging-marathon: wissel af tussen orale seks, handen en speeltjes ..." | Generic oral/edging, no anatomy named. |
| d079 | "Diep oraal dare: ... Gebruik alleen je mond en keel ... door totdat ze klaarkomen." | "Deep oral" implies penis but never stated; gender-neutral. Left null to be safe. |
| hh012 | "Met haar op haar rug, benen gespreid ... prikkel haar door te kussen, likken en zuigen ..." | Oral on a female target but no organ named in text (vagina implied by genderRequired only — rule forbids inferring from gender). |
| hh013 | "Geef haar orale seks tot ze begint te kreunen ..." | Generic oral on female target; organ not named in text. |
| hh041 | "Geef hem orale seks totdat hij dicht bij een klaarkoming is ..." | Generic oral on male target; "hem" not anatomically explicit (penis implied by gender only). |
| hh042 | "Beveel hem jou oraal te bevredigen ..." | Performer (female) receives oral; organ not named in text. |
| hh043 | "Geef hem orale seks ... Wissel van rol ... totdat hij klaarkomt. Dan ... totdat jij klaarkomt." | Mutual oral; neither organ explicitly named in text. |
| hh045 | "Terwijl je hem bevredigt, geef je expliciete complimenten ..." | "Bevredigt" (pleasure him) — act unspecified; could be oral/manual, no organ named. |
| hh051 | "Geef hem 3 tot 5 verleidelijke opdrachten — 'kus mijn nek', 'lik mijn binnendijen' ..." | Commands include licking inner thighs etc.; performer (female) receiving, but no genital explicitly required. |
| hh064 | "Terwijl je je partner oraal bevredigt ... 5 expliciete complimenten ..." | Generic oral, gender-neutral, no organ named. |
| hh066 | "Laat ze naar je toe kruipen en hun waarde bewijzen met alleen hun mond ..." | Oral on performer; gender-neutral, no organ named. |
| hh070 | "Laat je partner schrijlings op je gezicht ... Geef ze orale seks ..." | Face-sitting / oral; gender-neutral, receiver organ not specified. |

## public/packages/his-her.json

(hh* cards are shared with dares.json — same ids, same genitals values.) The ambiguous
hh* rows above (hh012, hh013, hh041, hh042, hh043, hh045, hh051, hh064, hh066, hh070)
apply identically here.

## public/packages/extreme-matchbox.json

| Card | Text (EN) | Why ambiguous / human decision |
|------|-----------|--------------------------------|
| ext_012 | "Send a video ... while your partner performs oral sex on you." | Performer receives oral; no organ named (penis or vagina). |
| ext_013 | "Perform oral sex on your partner on a cam-sharing website ..." | Generic oral on partner; receiver organ not named. |
| ext_015 | "Perform anal sex with your partner." | `penetration_ass` is present, but "with your partner" does not say who is the receiving party — cannot assign `anus` to performer vs target safely. Human should decide direction. |
| ext_028 | "Give your partner a foot job." | Footjob targets partner's genitals; likely penis but not stated — could apply to vulva. Left null. |
