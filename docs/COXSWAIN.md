# The coxswain

OpenErg's coxswain is a built-in voice coach. It watches the data the PM5 sends (pace, stroke
rate, distance, time, heart rate and the force curve of every stroke) and speaks short calls as
you row. It runs entirely on the phone, works offline, and says the same thing for the same row.
Calls are spoken, shown as a banner, or both (Settings → Coxswain).

## What it calls, and when

| Category | When it triggers | Example lines |
| --- | --- | --- |
| **Start & settle** | Stroke 1; on race pieces longer than ~2 min a "stay high" at stroke 6 and a settle at stroke 14 (stroke 10 in a rep). No settle in sprints or short pieces. Steady pieces get an easy start instead. | "Off we go. Clean first strokes." · "Settle NOW! Race pace one fifty!" · "Easy start. Build into it." |
| **Progress** | Regular marks (every 500 m / 1000 m / 5000 m, or every minute / 5 / 10 min on time pieces), halfway, last 500, last 250, last minute, last 30 s, last ten strokes. Only the latest mark is called if several are passed at once. | "Halfway. Averaging one fifty-one. Stay patient." · "LAST TWO FIFTY! Up two, NOW!" · "Last ten strokes. Make them count." |
| **Pacing** | From stroke 18 (race) or 10 (steady), when your last six strokes average ≥ 2 s off the target (3 s off your own average when there is no target). Repeats while it stays wrong, with a power ten after 35 % of the piece. "Too hot" if you are fast in the first quarter. | "Two seconds over target. Press back to one fifty." · "Out too hot. Back to one fifty, save it." · "Right on one fifty. Hold that." |
| **Rate** | Same start rule; when rate is more than 2 off the plan's target rate, and once it is back. | "Rate is twenty-six. Bring it up to twenty-eight." · "Lengthen out, back to twenty-four." |
| **Technique** | After stroke 12, when one fault shows in at least 6 of the last 10 strokes. One fault at a time: up to two cues, then praise when it is fixed, then a cool-down. | "Quick catch. Lock on and push." · "Slow the slide, let the wheel run." · "That is better, nice catch." |
| **Intervals** | Rep start (with target pace / rate), "last rep" on the final rep, a result at the end of each rep compared with the previous one, and in the rest a 30 s call naming the next rep plus a 10 s "sit ready". | "Rep three of six. Away you go. Target one forty-five." · "Rep two done, one forty-six. A second quicker than the last one." · "Ten seconds. Sit ready." |
| **Heart rate** | When a heart-rate zone is set: 20 s above the zone, or 60 s below it (after the first 2 min). Safety call whenever you go above your max heart rate. | "Above your zone. Lighter pressure." · "Heart rate above your max. Ease off now." |
| **Motivation** | Every 1–4 min (by frequency) after the first 45 s, alternating encouragement and a body cue; different lines in the last quarter. | "Good rhythm. Keep breathing." · "Sit tall, breathe out on the drive." · "Not long now. Keep it together." |
| **Finish** | When the PM5 reports the workout is over. | "And stop. Six fifty-eight point four for two thousand metres, average one forty-four. Well rowed." |

**The finish is for racing.** In the last 250 m (last minute on time pieces) and the last ten
strokes there are no technique cues, motivation lines, heart-rate zone calls or "ease off / settle"
pacing calls. You only hear progress calls, and "push" calls if you are slow. Rest calls are
only made during the rest. In "repeat until stopped" intervals reps are numbered without a total
("Rep four") and there is no "last rep" call.

Numbers are spoken the way a cox says them: 1:52.3 is "one fifty-two", 2:00 is "two flat",
1250 m is "twelve fifty", and 6:58.4 is "six fifty-eight point four".

## Changing how it sounds

- **Personality.** *Calm*: quiet and measured ("Settle in. Long strokes at one fifty."). *Encouraging*:
  warm and positive ("Into your rhythm! One fifty is yours!"). *Race*: loud and terse
  ("Stride! Long and mean at one fifty!"). Each personality has its own lines. Every call type
  has at least three lines, every corrective call (pace, rate, heart rate, rep slower, "fixed it") at
  least four, and each one is used before any repeats.
- **Frequency.** Minimal / normal / chatty sets the gap between ordinary calls (45 / 20 / 10 s),
  how often an unresolved pacing problem is repeated (60 / 30 / 20 s), the technique cool-down
  (90 / 45 / 25 s) and motivation (4 / 2 / 1 min; minimal drops ordinary motivation).
  Race-plan calls (start, marks, rest countdown, finish) only need a 3 s gap, and safety calls
  are never held back.
- **Toggles.** Pacing calls (pace + rate + heart-rate zone), technique calls, motivation calls
  and split/progress calls can each be turned off. Start, sprint, rest and safety calls stay on
  while the coxswain is enabled. Mute silences everything during a row.

## What drives the technique calls

Each stroke's force curve from the PM5 is analysed for shape: where the peak sits, how fast the
force rises, how full and smooth the curve is, and whether there are two humps. That gives faults
such as slow catch, early peak that fades, late peak (arms before legs), double peak (legs and
back not connected), weak finish, soft or jerky drive, short stroke, overreaching and
inconsistent strokes. Drive and recovery times add "rushed recovery" (recovery shorter than
1.25 × the drive at rates of 30 or below). The analysis module only flags what a single stroke shows, so the coxswain derives the rest itself,
against the piece's own strokes 6-15 (reset every rep): **short stroke** (drive length 8 % down),
**low power per stroke** (work per stroke 20 % down), **rate too high / too low** (rate 3 off your
settled rate, only when the plan has no rate target; with a target the Rate calls are used),
**inconsistent strokes** (stroke distance varies > 7 % over the last 10) and **slow recovery**
(recovery:drive ratio above the norm for the rate). A fault is only mentioned once it is persistent
(6 of the last 10 strokes), so a single odd stroke never triggers a call.

### Cue variety

Every fault has at least five cues per personality, each attacking it from a different angle so
repeats do not sound the same: a timing cue ("Hands away, then legs the moment you arrive"), a body
cue ("Shins vertical, chest up"), a feel cue ("Feel the handle load"), a focus-count cue ("Next
five: sharp catches") and a short command. Pacing, rate, heart-rate and rep-comparison calls also
carry four or more lines per personality. Wording follows common coxing and erg-coaching
vocabulary (length, catch, connection, ratio, "hang", "power ten"); no passage is copied.

### Limits and toggles

- **Rate calls** are off by default (`rateCalls`); when off there are no rate up/down calls, from a plan target or derived.
- **Muted faults** (`mutedFlags`) are never cued or picked as the focus.
- **Max cues per fault** (`maxCuesPerFault`, default 3; one fewer on steady-state pieces, minimum 1). The cue that reaches
  the cap gets a blunt lead-in ("Last call: quick catch.") and the fault is retired for the piece. A retired fault
  still gets one "Good change" style acknowledgement when it clears. Pace calls: with a set pace
  (pace boat, goal pace or pace plan) the coxswain keeps reminding at the repeat interval, uncapped. With no set
  pace, Training mode makes no pace calls (slowing down is your choice); Race mode holds you to your own average,
  capped on steady pieces with one "last call on pace", then silence until you are back on it.

## Style source

The phrase bank (`src/coach/phrases.ts`) is written in the manner of Harry Brightmore, cox of the GB
men's eight (Paris 2024 Olympic champions). The UI describes the voices neutrally.

The **race** personality follows his own recording of the Paris final
(https://www.youtube.com/watch?v=WJW5m76cpf0, auto-captions) and its description, which says the
race calls were made deliberately aggressive. Taken from it: number first (rate, split, elapsed time,
distance), one technical focus fired with "ready, go", doubled calls ("legs down, legs down"), his
short vocabulary (trust the rhythm, complete the strokes, move the hands, out long, long hanging
strokes, sit tall, shovel), "the next 500 wins this", numbered tiers through the finish, and "then
you are done". Lines are new, written in that manner, not a transcript; crew, rival and name calls
are left out because the erg has one rower. This supersedes the "no pushes" note below for races:
he does call tiers. The calm and encouraging personalities keep the quieter interview-based style.

**Confirmed from sources**

- Calm under pressure, calls as calmly as possible, "aggressive but calculated"; says a cox does not need to talk constantly:
  occasional key information beats constant shouting. Think of what a rower on an erg wants: split, rate, time left.
- Gives splits, rates and effective-drive information; does not believe in "pushes" or "moves", a race is won by
  whoever holds their speed best. Does not want "Legs!" shouted every stroke.
- Plan of smooth second and third 500s with one focus at halfway; starts at race pace as early as possible.
- In training: concise information, then lets the crew work. Uses the coxbox to keep rhythm and rate.
- Head-race recording write-up: updates on position, rivals and time, rhythm calls when needed, avoids repeating clichés.
- Technique themes: long leg drive, relaxed arms, pushing the boat to the finish, suspending properly in the middle of a piece.
- Self-described role: "crack the whistle" when the crew hurts.

**Our inference (not in sources)**

- Exact wording of every line, the "send it"/"legs"/"way enough" vocabulary (generic British coxing terms), and the
  last-500 and sprint calls. Nothing found documents his actual race call transcript, tone of voice or name use.
- Calm default intensity for all personalities (numbers first, one focus, hold-speed instead of surges).
- Steady-state pieces get their own quieter motivation bank (`motivationSteady`, rhythm and relaxation); races and
  intervals use the sharper one. Not sourced.

**Sources**

- https://www.row2k.com/features/6201/in-the-drivers-seat-with-harry-brightmore/
- https://jrn.news/finding-his-coxing-voice-harry-brightmore-and-nielsen-kellerman
- https://www.rowingrelated.com/2015/04/eights-head-video-and-coxswain.html
- https://marinelink.com/blogs/blog/olympiceights-gold-leaves-british-cox-jumping-with-joy-but-not-101527
- https://www.britishrowing.org/2024/10/harry-brightmore-olympic-champion-cox-retires-from-gb-rowing-team/
