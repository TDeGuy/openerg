/**
 * Coxswain phrase banks. Pure. Templates use {placeholders} filled by the engine with
 * TTS-friendly words (see speech.ts). Keep every template speakable in one breath (≤ 9 words).
 *
 * Style: modelled on the calm, informative, sparse calling of an elite eight cox (see
 * docs/COXSWAIN.md "Style source"): short calls, numbers (split, rate, distance to go) before
 * adjectives, one focus at a time. Calm and encouraging stay quiet ("hold your speed", a lift only
 * in the last 500); the race bank is deliberately aggressive, as his race recording is.
 */
import type { CoxPersonality, TechniqueFlag } from '@/core/types';

export type PhraseKey =
  | 'start'
  | 'startHigh'
  | 'settle'
  | 'startEasy'
  | 'settleSteady'
  | 'repStart'
  | 'repOpen'
  | 'lastRep'
  | 'milestone'
  | 'halfway'
  | 'last500'
  | 'last250'
  | 'lastTen'
  | 'timeLeft'
  | 'lastMinute'
  | 'last30s'
  | 'finish'
  | 'finishIntervals'
  | 'repDone'
  | 'repFaster'
  | 'repSlower'
  | 'repSame'
  | 'rest30'
  | 'rest10'
  | 'over'
  | 'under'
  | 'onTarget'
  | 'tooHot'
  | 'overOwn'
  | 'powerTen'
  | 'rateUp'
  | 'rateDown'
  | 'rateOn'
  | 'hrHigh'
  | 'hrLow'
  | 'safety'
  | 'motivation'
  | 'motivationLate'
  | 'motivationSteady'
  | 'focus'
  | 'improved'
  | 'finalWarning'
  | 'lastPace'
  | 'segWarn'
  | 'segUp'
  | 'segDown';

type Bank = Record<PhraseKey, string[]>;

const calm: Bank = {
  start: ['And go. Long and smooth.', 'Go. Strong first strokes.', 'Away we go. Quick hands.'],
  startHigh: ['Stay up a few more.', 'Hold the rate. Few more.', 'Good start. Settle in two.'],
  settle: ['Settle now. {pace}, long and smooth.', 'Lengthen in two. Settle at {pace}.', 'Rhythm now. {pace} is the number.'],
  startEasy: ['Easy start. Build into it.', 'Ease in. Warm up.', 'Relaxed to begin.'],
  settleSteady: ['Find your rhythm. Breathe.', 'Settle in. Long and relaxed.', 'Rhythm. Nice and even.'],
  repStart: ['Rep {rep} of {total}. Go.', 'Rep {rep} of {total}. Smooth start.', 'Here is rep {rep} of {total}.'],
  repOpen: ['Rep {rep}. Go.', 'Rep {rep}. Smooth start.', 'Here is rep {rep}.'],
  lastRep: ['Last rep. Make it the best.', 'Final rep. Hold your form.', 'Last one. Finish it well.'],
  milestone: ['{done} done, {remain} to go. {avg}.', '{remain} to go. Holding {avg}.', '{done} gone. Average {avg}.'],
  halfway: ['Halfway. {avg}. One focus now.', 'That is halfway, {avg} average. Hold it.', 'Halfway. {avg}. Stay smooth.'],
  last500: ['Last five hundred. Start to lift.', 'Five hundred to go. Lift it now.', 'Final five hundred. Send it.'],
  last250: ['Two fifty to go. Take the rate up.', 'Last two fifty. Quicker hands.', 'Two fifty. Lift it now.'],
  lastTen: ['Ten to go. Long and strong.', 'Last ten strokes. Everything now.', 'Ten. Make them count.'],
  timeLeft: ['{left} to go. {avg}.', '{left} left, holding {avg}.', '{left} remaining. Average {avg}.'],
  lastMinute: ['One minute to go. Start lifting.', 'Last minute. Lift it now.', 'A minute left. Send it.'],
  last30s: ['Thirty seconds. Everything now.', 'Thirty to go. Empty it.', 'Last thirty. Go.'],
  finish: ['Way enough. {result}. Well rowed.', 'That is it. {result}. Good work.', 'Stop. {result}. Nicely done.'],
  finishIntervals: ['Way enough. {result}. Well rowed.', 'Session done. {result}. Good work.', 'That is the set. {result}.'],
  repDone: ['Rep {rep} done, {split}.', 'That is rep {rep}, {split}.', 'Rep {rep}, average {split}.'],
  repFaster: ['{diff} quicker than the last one.', 'Up {diff} on the last rep.', 'Faster than the last by {diff}.'],
  repSlower: ['{diff} slower than the last one.', 'Down {diff} on the last rep.', '{diff} off the last one. Stay with it.', 'Down {diff} on that one. Reset and go again.', '{diff} slower. Stay relaxed, build again.'],
  repSame: ['Same as the last one. Consistent.', 'Right on your last rep.', 'Matched the last one. Good.'],
  rest30: ['Thirty seconds. {next}', 'Thirty seconds of rest. {next}', 'Half a minute. {next}'],
  rest10: ['Ten seconds. Sit ready.', 'Ten seconds. Come forward, ready.', 'Ten seconds. Hands on, deep breath.'],
  over: ['{diff} over target. Back to {target}.', 'You are {diff} slow. Target {target}.', '{diff} off the pace. Lift to {target}.', 'Legs. {diff} over, target {target}.', 'Longer legs. Bring it back to {target}.', '{diff} slow. Drive through the feet, {target}.'],
  under: ['{diff} under target. Settle to {target}.', 'A touch quick, {diff} under. {target} is fine.', '{diff} quick. Relax back to {target}.', 'Hold it at {target}. That is plenty.', '{diff} quick. Let the slide run, {target}.'],
  onTarget: ['Right on {target}. Hold that.', 'That is the pace. Keep it there.', 'On target. Hold your speed.'],
  tooHot: ['{diff} quick, too early. Settle to {target}.', 'Too hot. Back to {target}, save it.', 'Too fast for now. {target} is the pace.', 'Too fast early. Breathe, find {target}.', 'Back off a touch. Save it for later.'],
  overOwn: ['Pace has drifted {diff}. Back to {target}.', '{diff} off your average. Bring it back.', 'Slipping {diff}. Back to {target}.', 'You are fading {diff}. Sit tall, hold it.', 'Pace is leaking {diff}. Stay long, drive.', 'Hold your form, {diff} back to {target}.'],
  powerTen: ['Ten strong ones, starting now.', 'Ten firm strokes. Now.', 'Give me ten with the legs. Now.', 'Ten with a bit more leg. Now.', 'Ten strokes, firmer drive. Now.'],
  rateUp: ['Rate is {rate}. Up to {target}.', 'Up a little, aim for {target}.', 'Quicker hands, rate {target}.', 'Shorten the recovery, rate {target}.', 'A touch quicker at the front. {target}.', 'Rate {rate}. Tighten up to {target}.'],
  rateDown: ['Rate is {rate}. Ease it to {target}.', 'Lengthen out, back to {target}.', 'Slow the slide, rate {target}.', 'Rate {rate}. Breathe, back to {target}.', 'Wait at the front, rate {target}.', 'Easy up the slide, rate {target}.'],
  rateOn: ['Rate is good, {target}.', 'Rating right where we want it.', 'That is {target}. Hold the rhythm.'],
  hrHigh: ['Heart rate above your zone. Ease off a touch.', 'Above your zone. Lighter pressure.', 'Heart rate is high. Relax a little.', 'Heart rate high. Long, easy recovery.', 'Drop the pressure, let it settle.', 'Above zone. Breathe out, soften the drive.'],
  hrLow: ['Heart rate below the zone. A bit more pressure.', 'You have room. Lift the effort slightly.', 'Below your zone. Press a bit harder.', 'Below your zone. Push the legs a bit more.', 'Heart rate is low. Add some pressure.', 'Room to work. Press a little harder.'],
  safety: ['Heart rate above your max. Ease off now.', 'Over your maximum heart rate. Slow down, breathe.', 'Heart rate over your max. Stop pushing.', 'Above maximum. Easy paddling, steady breaths.'],
  motivation: ['Nice work. Stay relaxed.', 'Good rhythm. Keep breathing.', 'Steady, honest work.', 'One stroke at a time.'],
  motivationLate: ['Into the last part. Stay tall.', 'Not long now. Keep it together.', 'Finish this calmly and strongly.'],
  motivationSteady: ['Nice and even. Stay relaxed.', 'Good rhythm. Keep it there.', 'Breathe. Loose shoulders.', 'Smooth strokes. Keep it going.'],
  focus: ['Relax the grip, loose shoulders.', 'Long legs, quiet hands.', 'Sit tall, breathe out on the drive.', 'Smooth slide, no rush.'],
  improved: ['That is better, nice {what}.', 'Good, that {what} looks better.', 'Yes, much better {what}.', 'Better, that {what} feels smoother.', 'Good, hold that {what}.', 'Good change.', 'Good fix, that is the {what}.', 'That is it. Fixed.', 'Good, {what} is sorted.'],
  finalWarning: ['Last call:', 'Final time:', 'I will not say it again:', 'Last warning:'],
  lastPace: ['Last call on pace. {target} when you can.', 'Final reminder, {target}. Your call.', 'Last time: {target} is the pace.', 'Not nagging again. {target} please.'],
  segWarn: ['{what} in {when}.', 'Next, {what}, in {when}.', 'In {when}, {what}.'],
  segUp: ['Up to {what}, now.', 'Now. {what}. Smooth change.', 'Lift to {what}, now.', 'Lift it, now.'],
  segDown: ['Down to {what}, now.', 'Ease to {what}, now.', 'Now, {what}. Settle and lengthen.', 'Easy back, now.'],
};

const encouraging: Bank = {
  start: ['Here we go. Big first strokes.', 'Go. Strong and clean.', 'And away we go. Attack it.'],
  startHigh: ['Stay up. Keep building.', 'Great start. Hold it a bit longer.', 'Nice and sharp. Few more.'],
  settle: ['Lengthen in two, and settle. {pace}.', 'Settle now. Long strokes at {pace}.', 'Into your rhythm. {pace} is yours.'],
  startEasy: ['Nice and easy to begin.', 'Gentle start, we have time.', 'Ease into it. Let it come.'],
  settleSteady: ['Lovely. Settle in and breathe.', 'Find a rhythm you can hold.', 'Relax and let the strokes flow.'],
  repStart: ["Rep {rep} of {total}. Let's go.", 'Here comes rep {rep} of {total}.', 'Rep {rep} of {total}. Strong start.'],
  repOpen: ["Rep {rep}. Let's go.", 'Here comes rep {rep}.', 'Rep {rep}. Strong start.'],
  lastRep: ['Last rep. Make it your best.', 'Final one. Leave it all here.', 'Last rep. Finish strong.'],
  milestone: ['{done} down, {remain} to go. {avg}.', "{remain} to go. You're holding {avg}.", '{done} done. {avg} average, great stuff.'],
  halfway: ["Halfway. {avg}. You've got this.", "That's halfway, {avg} average. Brilliant.", 'Halfway. {avg}. Keep it coming.'],
  last500: ['Last five hundred. Here we go.', 'Five hundred to go. This is where it counts.', 'Final five hundred. You have it, send it.'],
  last250: ['Last two fifty. Take it up now.', 'Two fifty to go. Rate up.', 'Final two fifty. Quicker hands.'],
  lastTen: ['Last ten. Empty the tank.', 'Ten strokes. Give me everything.', 'Final ten. Big legs.'],
  timeLeft: ['{left} to go. {avg} so far.', '{left} left, holding {avg}. Great work.', '{left} to go. {avg}, lovely.'],
  lastMinute: ['One minute. Start the lift.', 'Last minute. Send it, you can.', 'A minute to go. Up it goes.'],
  last30s: ['Thirty seconds. Everything you have.', "Last thirty. You've got more.", 'Thirty to go. Go, go.'],
  finish: ['Way enough. {result}. Fantastic work.', "That's it. {result}. Great piece.", 'Stop. {result}. Be proud of that.'],
  finishIntervals: ['Way enough. {result}. Awesome session.', 'Done. {result}. You nailed it.', 'Session complete. {result}. Great work.'],
  repDone: ['Rep {rep} in the bag, {split}.', 'Rep {rep} done. {split}.', 'There is rep {rep}, {split}.'],
  repFaster: ['{diff} faster than the last. Brilliant.', 'Quicker than the last by {diff}. Love it.', 'Up {diff} on the last one. Yes.'],
  repSlower: ["{diff} slower. We'll get it back.", 'Down {diff} on the last one. Keep fighting.', '{diff} off. Next one is yours.', '{diff} slower. Shake it off, go again.', 'Down {diff}. Reset, you have the next one.'],
  repSame: ['Bang on your last rep. So consistent.', 'Same as the last one. Perfect.', 'Matched it exactly. Lovely.'],
  rest30: ['Thirty seconds. Get your breath. {next}', 'Thirty to go, nice and calm. {next}', 'Half a minute, shake it out. {next}'],
  rest10: ['Ten seconds, sit ready.', 'Ten seconds. Forward and ready, you have this.', 'Ten. Here we go again.'],
  over: ['{diff} over. Back to {target}.', "You're {diff} slow. Back to {target}.", '{diff} off the pace. {target}, you can.', '{diff} behind. Drive with the legs, {target}.', 'Lift it. {target} is right there.', '{diff} slow. Sit up, send it, {target}.'],
  under: ['{diff} under. Nice, but sit on {target}.', "You're {diff} quick. Hold {target}, stay in control.", '{diff} quick. Ease to {target}, save it.', 'Nice speed. Settle back to {target}.', '{diff} quick. Breathe, hold {target}.'],
  onTarget: ['Bang on {target}. Hold that.', "That's the pace. Lovely.", 'Spot on. Hold your speed.'],
  tooHot: ["Easy. You're out too hot. Settle to {target}.", 'Too fast too early. {target}, save it.', '{diff} quick. Settle to {target} for now.', 'Whoa, too quick. Settle to {target}.', 'Great energy. Save it, {target}.'],
  overOwn: ["You've dropped {diff}. Back to {target}.", 'Pace is slipping {diff}. Bring it back.', '{diff} off your average. You can lift it.', 'You are fading {diff}. Sit tall, stay with it.', 'Pace slipping {diff}. Dig in, you can.', '{diff} off. Hold your length, bring it back.'],
  powerTen: ['Ten big ones, in two... now.', 'Ten with the legs, you can. Now.', 'Ten strong ones to lift it. Go.', 'Ten strong ones. Show me your legs.', 'Ten now. You have it.'],
  rateUp: ["Rate's at {rate}. Up to {target}.", 'Quicker hands. Rate {target}.', 'Bring it up to {target}, keep the length.', 'Quicken up a little. Rate {target}.', 'Rate {rate}. Snap the hands away, {target}.', 'Lively recovery. Up to {target}.'],
  rateDown: ["Rate's at {rate}. Down to {target}, lengthen out.", 'Too busy. Back down to {target}.', 'Slow the slide, rate {target}, easy.', 'Rate {rate}. Calm it down to {target}.', 'Breathe at the front, rate {target}.', 'Slow and strong. Back to {target}.'],
  rateOn: ['Rate is spot on, {target}.', 'Great rhythm, right on rate.', "That's {target}. Lovely rhythm."],
  hrHigh: ["Heart rate's above your zone. Ease off a touch.", "You're above the zone, relax a bit.", 'Heart rate is high. Lighter pressure.', 'Heart rate is high. Relax and breathe.', 'Above your zone, ease it down, nice and smooth.', 'Settle it down, long easy strokes.'],
  hrLow: ["Heart rate's below the zone. More pressure.", "You've got more in you. Lift it slightly.", 'Below your zone. A little harder.', 'Below your zone. Let us add some pressure.', 'Heart rate is low, you have more.', 'More legs. Lift the effort.'],
  safety: ['Heart rate is over your max. Ease off now.', 'Over your max heart rate. Slow down, breathe.', 'Heart rate over max. Stop pushing, please.', 'Above your maximum. Easy now, breathe.'],
  motivation: ["You're rowing really well. Keep it up.", 'Strong and steady, love it.', 'Every stroke counts. Stay with it.', "Great work, you're in control."],
  motivationLate: ["Into the last part. You've got this.", 'Not long now, stay strong.', 'Finish what you started. Keep going.'],
  motivationSteady: ['Lovely rhythm. Keep it going.', 'Nice and relaxed. Stay long.', 'Great steady work. Breathe.', 'Smooth and strong. Hold that.'],
  focus: ['Relax the shoulders, strong legs.', 'Long and strong, feel the drive.', 'Breathe and stay tall.', 'Loose grip, sharp catch.'],
  improved: ["That's it, much better {what}.", 'Yes. Great {what}, keep that.', "Lovely. That's the {what} we want.", 'Better {what}. Keep that going.', 'Yes, that {what} is working.', 'Good change, well done.', 'Good fix, lovely {what}.', 'That is it. Fixed, lovely.', 'Yes. {what} sorted.'],
  finalWarning: ['Last call!', 'Final time!', 'I will not say it again!', 'Last warning, you have it!'],
  lastPace: ['Last call on pace. {target}, you can.', 'Final reminder, {target}. Over to you.', 'Last time. {target} is yours.', 'One last nudge, {target}.'],
  segWarn: ['{what} in {when}. Get ready.', 'Coming up, {what}, in {when}.', 'In {when}, {what}. You can.'],
  segUp: ['Up to {what}, now. Go.', 'Now, {what}. Here we go.', 'Lift to {what}, now. Lovely.', 'Lift it, now. Go.'],
  segDown: ['Down to {what}, now. Nice and easy.', 'Settle to {what}, now.', 'Now {what}. Breathe, lengthen out.', 'Settle it back, now.'],
};

// Race bank: modelled on a recording of an Olympic eights final (docs/COXSWAIN.md "Style source"):
// number first, one technical focus fired with "ready, go", doubled calls, tiers through the finish.
const race: Bank = {
  start: ['Go. Legs down. Hands moving.', 'Go. Traction. Legs down.', 'And go. Legs down, legs down.'],
  startHigh: ['Good start. Stay up. Trust it.', 'High, efficient power strokes. Ready, go.', 'Good legs. Hold the rate.'],
  settle: ['Rhythm now. Trust the rhythm. {pace}.', 'Long strokes now. Sitting on {pace}.', 'Hands clear, into rhythm. {pace}.'],
  startEasy: ['Build in. Controlled.', 'Ease in, but stay sharp.', 'Warm the legs. Work comes soon.'],
  settleSteady: ['Trust the rhythm. Out long.', 'Long, hanging strokes. Settle.', 'Good rhythm now. Complete the strokes.'],
  repStart: ['Rep {rep} of {total}. Ready, go.', 'Rep {rep} of {total}. Legs down.', 'Rep {rep} of {total}. Get to work.'],
  repOpen: ['Rep {rep}. Ready, go.', 'Rep {rep}. Legs down.', 'Rep {rep}. Get to work.'],
  lastRep: ['Last rep, then you are done. Go.', 'Final rep. Do not stop.', 'Last one. This wins the session.'],
  milestone: ['Through {done}. {avg}. Trust this pace.', '{remain} to go. We are on {avg}.', '{done} gone. Sitting on {avg}. Good.'],
  halfway: ['Halfway. Sit tall, be long. {avg}.', 'Halfway. This next part counts double.', 'Through halfway on {avg}. Get to work.'],
  last500: ['Last five hundred wins this. Ready, go.', 'Five hundred left. Volume up. Legs down.', 'Inside five hundred. Tier one, now.'],
  last250: ['Inside two fifty. Legs down, legs down.', 'Two fifty. Tier two. Go.', 'Two fifty left. Do not stop.'],
  lastTen: ['Last ten. Legs, hips. Legs, hips.', 'Ten to the line. Hips open. Go.', 'Ten left. Eyes in. Shovel.'],
  timeLeft: ['{left} left. We are on {avg}.', '{left} to go. Sitting on {avg}.', '{left}. {avg}. Believe in this pace.'],
  lastMinute: ['This is the minute. Get moving. Now.', 'One minute, then you are done. Go.', 'Next minute wins this. Long strokes, move.'],
  last30s: ['Thirty seconds. We can go again. Go.', 'Thirty left. Sets of five, legs.', 'Thirty. Do not stop. Eyes in.'],
  finish: ['Through. Yes. {result}.', 'Way enough. {result}. That is the job.', 'Through the line. {result}. Huge.'],
  finishIntervals: ['Way enough. {result}. Job done.', 'Through. {result}. That is the work.', 'Done. {result}. Really good work.'],
  repDone: ['Rep {rep}. {split}.', 'Rep {rep} through, {split}.', 'That was rep {rep}. {split}.'],
  repFaster: ['{diff} quicker. Good. Go again.', 'Up {diff}. We can boost this.', '{diff} faster. Trust it.'],
  repSlower: ['{diff} slower. Legs down next one.', 'Lost {diff}. Take it back.', 'Down {diff}. Complete the strokes next rep.', '{diff} off. Sit tall, go again.', 'Lost {diff}. Next one, get to work.'],
  repSame: ['Same split. Good rhythm.', 'Level with the last one. Trust it.', 'Matched it. Go again.'],
  rest30: ['Thirty seconds. Listen. {next}', 'Thirty. Very focused, very awake. {next}', 'Thirty seconds. Get ready. {next}'],
  rest10: ['Ten seconds. Sit tall. Ready.', 'Ten. Hands on. Get ready.', 'Ten seconds. Eyes in.'],
  over: ['{diff} down. Legs down, back to {target}.', 'We are {diff} off. Get to {target}.', '{diff} over. Long strokes, move. {target}.', 'Legs down, legs down. {target}.', '{diff} off. We can boost this. {target}.', 'Listen. {diff} down. Get to work.'],
  under: ['{diff} up on target. Trust {target}.', '{diff} quick. Stay long, sit on {target}.', 'Good speed. Hold {target}, keep the length.', '{diff} up. Rhythm. {target} is the plan.', 'Up {diff}. Keep it simple, {target}.'],
  onTarget: ['Right on {target}. Trust the rhythm.', 'Level on target. Believe in this pace.', 'On {target}. Good. Keep completing the strokes.'],
  tooHot: ['{diff} too quick. Trust the rhythm, {target}.', 'Too hot. Long strokes, back to {target}.', 'Listen. {target} is the pace. Trust it.', 'Out too fast. Settle onto {target}.', 'Too quick early. Rhythm. {target}.'],
  overOwn: ['Dropped {diff}. Legs down, legs down.', 'Slipping {diff}. Sit tall, be long.', '{diff} off your speed. Complete the strokes.', 'Fading {diff}. Do not stop. Legs.', '{diff} down. Out long. Hold {target}.', 'Losing {diff}. Get back to work.'],
  powerTen: ['Legs and hips. Ready, go.', 'Sets of five on the legs. Go.', 'Volume up. Ten, legs down. Go.', 'Ten long, hanging strokes. Ready, go.', 'Next ten wins this. Legs. Go.'],
  rateUp: ['On {rate}. Move the hands, {target}.', 'Rate {rate}. Hands clear, up to {target}.', 'Push the hands away. {target}.', 'We want {target}. Move the hands.', 'Rate {target}. Quick hands, long legs.', 'On {rate}. Up to {target}. Go.'],
  rateDown: ['On {rate}. Longer. Back to {target}.', 'Rate {rate}. Long, hanging strokes, {target}.', 'Too busy. Out long, rate {target}.', 'Complete the strokes. Down to {target}.', 'Length over rate. {target}.', 'On {rate}. Trust the rhythm, {target}.'],
  rateOn: ['On {target}. Good rhythm.', '{target} on rate. Trust it.', 'Rate is {target}. Really nice.'],
  hrHigh: ["Heart rate's over the zone. Back off a notch.", 'Above zone. Control the effort.', 'Heart rate high. Ease the pressure.', 'Pressure down. Stay in the zone.', 'Over the zone. Control it.', 'Zone is blown. Back off a notch.'],
  hrLow: ['Heart rate low for this zone. Push harder.', 'Under the zone. Put some work in.', 'Heart rate low. More pressure.', 'Heart rate low. Hit it harder.', 'Zone is low. Put the legs in.', 'Not enough. More pressure.'],
  safety: ['STOP pushing. Heart rate is over your max.', 'Over your max heart rate. Back off, breathe.', 'Heart rate over max. Stop pushing, breathe.', 'Over max. Ease off now.'],
  motivation: ['Trust the rhythm. Trust the rhythm.', 'Good. Keep completing the strokes.', 'Believe in this pace. Out long.', 'Really nice. Legs down, hands moving.', 'Keep the length. Keep coming out long.'],
  motivationLate: ['Very focused now. Very awake.', 'Do not stop. Eyes in.', 'Then you are done. Keep moving.', 'We can go again. Legs.'],
  motivationSteady: ['Good rhythm. Keep it simple.', 'Long, hanging strokes. Trust it.', 'Complete the strokes. Hands moving.', 'Sit tall. Out long.'],
  focus: ['Legs down. Move the hands.', 'Long suspension. Ready, go.', 'Sit tall and be long.', 'Legs, hips. Legs, hips.', 'Complete the strokes. Hands away.'],
  improved: ['Yeah. That is good. Better {what}.', 'Good. {what} fixed. Trust it.', 'Really nice {what}. Keep that.', 'Good change. Yes.', 'Good fix. Hold that {what}.', 'Yes. That is the {what}.', 'Better. {what} is sorted.'],
  finalWarning: ['LAST CALL.', 'FINAL time.', 'Not saying it again.', 'LAST warning.'],
  lastPace: ['LAST call on pace. {target}.', 'Final warning. {target}. Your race.', 'Last time. {target}, NOW.', 'Once more, {target}. Then it is yours.'],
  segWarn: ['{what} in {when}. Ready.', '{when}. Then {what}.', 'In {when}, {what}. Get ready.'],
  segUp: ['Up to {what}. Ready, go.', '{what}. Now. Go.', 'Now. {what}. Legs down.', 'Lift it. Now.'],
  segDown: ['Down to {what}. Control.', 'Now. {what}. Long strokes.', 'Back to {what}. Stay long.', 'Settle it back. Now.'],
};

export const PHRASES: Record<CoxPersonality, Bank> = { calm, encouraging, race };

type Cues = Record<CoxPersonality, string[]>;

/**
 * Technique cues: per flag and personality, several corrective angles on the same fault
 * (timing, body, feel, focus-count) so repeated calls never sound the same.
 */
export const TECHNIQUE_CUES: Record<TechniqueFlag, { cues: Cues; what: string }> = {
  'slow-catch': {
    what: 'catch',
    cues: {
      calm: ['Quick catch. Lock on and push.', 'Hands away, then legs the moment you arrive.', 'Feel the handle load as you reach the front.', 'Next five: sharp catches.', 'No pause at the front. Turn it around.', 'Hands keep moving through the catch.', 'Shoulders low, then hook and send.'],
      encouraging: ['Sharp catch. Lock on and go.', 'Legs the moment you arrive.', 'Feel it grab the water, nice and quick.', 'Next five, snappy catches. You can.', "Don't wait at the front, send it.", 'Hook and send. Hands never stop.', 'Relaxed shoulders, sharp hook at the front.'],
      race: ['CATCH. Lock on, drive.', 'Legs on at the front. No wait.', 'Grab it hard. Hit the catch.', 'Next five. Sharp catches. GO.', 'Turn it round. No pause.', 'Hook. Send. Hit the catch.', 'Hands moving. Drive.'],
    },
  },
  'early-peak-fade': {
    what: 'follow-through',
    cues: {
      calm: ["Don't kick and die. Carry it through.", 'Connect the legs to the swing.', 'Keep the handle accelerating to the body.', 'Legs, then swing, then arms. Sustain it.', 'Next five: strong all the way to the finish.', 'Gather speed from a long leg drive.'],
      encouraging: ['Carry the legs through, keep building.', 'Link legs into swing, smooth and strong.', 'Keep the handle speeding up.', 'Legs, back, arms, one long push.', 'Next five, hold the pressure to the end.', 'Long leg drive, build it all the way.'],
      race: ["Don't die. Carry it through.", 'Legs into swing. Connect it.', 'Accelerate to the finish. Handle fast.', 'Hold it to the end. Next five.', 'Keep pushing after the legs.', 'Legs, body, arms. Accelerate.'],
    },
  },
  'late-peak': {
    what: 'leg drive',
    cues: {
      calm: ["Legs first, don't pull with the arms.", 'Load the legs at the catch.', 'Drive from the feet, arms finish it.', 'Front-end pressure. Legs before back.', 'Next five: push the feet first.', 'Legs, body, arms. Legs do the early work.'],
      encouraging: ['Legs first, arms last. Push the floor.', 'Load the legs early.', 'Feet drive it, arms just finish.', 'Pressure at the front. Legs go first.', 'Next five, big early legs.', 'Legs, body, arms, in that order.'],
      race: ['LEGS first. Not arms.', 'Load it early. Legs now.', 'Feet drive. Arms finish.', 'Front-end pressure. Hit it.', 'Next five. Legs, legs, legs.', 'Legs, body, arms. Order.'],
    },
  },
  'double-peak': {
    what: 'connection',
    cues: {
      calm: ['Legs and body together. Hang off it.', 'One smooth push, no gap.', 'Brace the core, connect legs to handle.', 'Feel one steady load through the drive.', 'Next five: one push, no dip.'],
      encouraging: ['Legs and back together, one push.', 'Smooth through the middle, no gap.', 'Brace the core and connect it.', 'Feel one long steady squeeze.', 'Next five, one drive, no dip.'],
      race: ['Connect it. One drive.', 'No gap. Legs into back.', 'Core tight. Hang on the handle.', 'One push. No dip.', 'Next five. Solid through the middle.'],
    },
  },
  'weak-finish': {
    what: 'finish',
    cues: {
      calm: ['Finish it off. Handle to the ribs.', 'Strong finish, lean back slightly.', "Don't cut it short. Accelerate into the body.", 'Squeeze the finish, elbows past the body.', 'Next five: draw all the way home.', 'Legs, finish. Draw through to the ribs.'],
      encouraging: ['Finish it off. Handle to the ribs.', 'Draw it home, strong at the end.', 'Squeeze through the finish.', 'Elbows past the body, nice and clean.', 'Next five, finish every stroke.', 'Legs, finish. Send it home.'],
      race: ['Complete the strokes. Handle to the ribs.', 'Squeeze it home. Elbows back.', 'Do not cut it short.', 'Finish it, then move the hands.', 'Next five. Complete every stroke.', 'Legs, finish. Send it.'],
    },
  },
  'soft-drive': {
    what: 'pressure',
    cues: {
      calm: ['More pressure on the footplate. Really push.', 'Push the floor away.', 'Bigger drive, weight behind it.', 'Hang your weight off the handle.', 'Next five: heavier strokes.', 'Legs do the early work. Push hard.'],
      encouraging: ['More pressure. Push the footplate.', 'Push the floor away, you have it.', 'Bigger drive, put your weight in.', 'Feel the handle get heavy.', 'Next five, heavy legs.', 'Legs drive it. Send it, hard.'],
      race: ['Legs down. Legs down.', 'Long suspension. Hang off it.', 'Put weight on it. Hang.', 'Heavy handle. Big legs.', 'Next five. Shovel them down.', 'Legs, hips. Push the footplate.'],
    },
  },
  'jerky-drive': {
    what: 'drive',
    cues: {
      calm: ["Smooth it out. Squeeze, don't punch.", "Build the pressure, don't snatch.", 'Accelerate smoothly through the drive.', 'Firm but smooth, no jerk at the catch.', 'Next five: silky pressure.'],
      encouraging: ['Smooth it out, squeeze it on.', 'Build the pressure, nice and even.', 'Roll the power on gradually.', 'Firm and smooth, lovely.', 'Next five, silky strokes.'],
      race: ['SMOOTH. Squeeze it on.', 'No snatching. Build it.', 'Roll it on. Accelerate.', 'Firm, not jerky. Flow.', 'Next five. Smooth power.'],
    },
  },
  'short-stroke': {
    what: 'length',
    cues: {
      calm: ['Get the full length. Reach to the front.', 'All the way forward, shins vertical.', 'Longer strokes, use the whole slide.', 'Lengthen out, full compression.', 'Next five: reach and rock over.', 'Arms, body, legs forward. Reach for the catch.'],
      encouraging: ['Reach for it. Full length.', 'All the way forward, shins vertical.', 'Use the whole slide, lovely long strokes.', 'Lengthen out, go for the front.', 'Next five, reach long.', 'Arms, body, legs, reach for the catch.'],
      race: ['Out long. Get long.', 'Full slide. Sit tall, be long.', 'Shins vertical. Get long.', 'Keep the length. Keep coming out long.', 'Next five. Long. Long. Long.', 'Reach. Arms, body, legs.'],
    },
  },
  overreaching: {
    what: 'position at the front',
    cues: {
      calm: ["Don't overreach. Shins vertical, chest up.", "Stop at the front, don't dive in.", 'Sit tall at the catch, no lunging.', "Compress, don't collapse.", 'Next five: shoulders over the hips.'],
      encouraging: ['Stay tall at the front, no overreach.', 'Stop at vertical shins.', 'Chest up, no lunging.', 'Strong and compact at the catch.', 'Next five, tall at the front.'],
      race: ['Do not overreach. Chest up.', 'Stop at the shins. Hold.', 'Sit tall. No lunge.', 'Compact catch. Stay strong.', 'Next five. Tight at the front.'],
    },
  },
  'rushed-recovery': {
    what: 'ratio',
    cues: {
      calm: ['Slow the slide, let the wheel run.', 'Easy forward, quick on the drive.', 'Hands, body, then slide. No rush.', 'Patience on the recovery.', 'Next five: count one, two on the way up.', 'Arms, body, legs. Recovery slower than the drive.'],
      encouraging: ['Slow the slide, let it flow.', 'Easy forward, strong back.', 'Hands, body, slide, no rush.', 'Patient recovery, lovely.', 'Next five, count one-two up the slide.', 'Arms, body, legs, nice and slow up.'],
      race: ['Control the slide. Do not rush.', 'Slow up, fast back.', 'Hands, body, slide.', 'Patience. Then explode.', 'Next five. Two beats up.', 'Arms, body, legs. Slow up.'],
    },
  },
  'slow-recovery': {
    what: 'rhythm',
    cues: {
      calm: ["Keep the slide moving, don't stall.", 'Hands away quickly, keep it flowing.', "Don't hang at the finish.", 'Smooth continuous recovery, no pauses.', 'Next five: flow to the front.'],
      encouraging: ['Keep it flowing, no stalling.', 'Hands away quick, keep moving.', "Don't hang at the finish.", 'Smooth and continuous, love it.', 'Next five, flow up the slide.'],
      race: ['Move the hands. No stall.', 'Hands clear. Flow.', 'Do not hang at the finish.', 'Push the hands away. Go.', 'Next five. Hands moving.'],
    },
  },
  'inconsistent-strokes': {
    what: 'consistency',
    cues: {
      calm: ['Make every stroke the same.', 'Lock in, stroke after stroke.', 'Same length, same pressure, every one.', 'Copy the last good stroke.', 'Next five: identical strokes.'],
      encouraging: ['Make every stroke match.', 'Lock in, one after another.', 'Same length, same power, every time.', 'Copy your best stroke.', 'Next five, all identical.'],
      race: ['Every stroke the SAME.', 'Lock in. Repeat it.', 'Same length. Same power.', 'Copy the good one.', 'Next five. Identical.'],
    },
  },
  'rate-too-high': {
    what: 'rhythm',
    cues: {
      calm: ['Rate is creeping up. Lengthen it out.', 'Bring the rating down, more power per stroke.', 'Slower slide, longer and stronger.', 'Too busy. Drop a pip, push harder.', 'Next five: wait at the front.'],
      encouraging: ['Rate is creeping up. Lengthen out.', 'Down a touch, more power each one.', 'Slow the slide, strong strokes.', 'Too busy, drop one and push.', 'Next five, calm and long.'],
      race: ['Rate creeping. Length.', 'Drop it. Power per stroke.', 'Slow slide. Hit harder.', 'Too busy. Down one.', 'Next five. Control the slide.'],
    },
  },
  'rate-too-low': {
    what: 'rhythm',
    cues: {
      calm: ['Pick the rate up a touch.', 'Bring the rate up, keep the length.', 'Quicker recovery, lift the rating.', 'Up a pip, stay long.', 'Next five: lively hands away.'],
      encouraging: ['Lift the rate a touch.', 'Rate up, keep it long.', 'Quicker hands away, lovely.', 'Up one, stay long.', 'Next five, a bit livelier.'],
      race: ['Rate UP. Keep length.', 'Quicker. Lift it.', 'Hands away fast.', 'Up one. Stay long.', 'Next five. Lively.'],
    },
  },
  'low-power-per-stroke': {
    what: 'power',
    cues: {
      calm: ['More power each stroke. Harder, not faster.', 'Make each stroke count. Heavy legs.', 'Put more into every drive.', 'Press harder through the footplate.', 'Next five: full pressure.'],
      encouraging: ['More into every stroke. Harder, not faster.', 'Make them count, heavy legs.', 'Put more into each drive.', 'Press the footplate, you have more.', 'Next five, full pressure.'],
      race: ['Harder, not faster. Power.', 'Make it count. Heavy legs.', 'More in every drive.', 'Press. Footplate.', 'Next five. Full pressure.'],
    },
  },
};

/** Fills placeholders and capitalises each sentence start (vars are passed lower-case). */
export function fill(template: string, vars: Record<string, string> = {}): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/** Picks phrases with an injectable RNG; every variant of a key is used once before any repeats. */
export class PhraseBook {
  private bags = new Map<string, number[]>();
  private last = new Map<string, number>();
  constructor(
    public personality: CoxPersonality,
    private rng: () => number,
  ) {}

  private choose(key: string, options: string[]): string {
    if (options.length === 0) return '';
    let bag = this.bags.get(key);
    if (!bag?.length) {
      bag = options.map((_, i) => i);
      this.bags.set(key, bag);
    }
    let j = Math.floor(this.rng() * bag.length) % bag.length;
    if (bag.length > 1 && bag[j] === this.last.get(key)) j = (j + 1) % bag.length; // no repeat across a refill
    const i = bag.splice(j, 1)[0]!;
    this.last.set(key, i);
    return options[i]!;
  }

  say(key: PhraseKey, vars?: Record<string, string>): string {
    return fill(this.choose(`${this.personality}:${key}`, PHRASES[this.personality][key]), vars);
  }

  technique(flag: TechniqueFlag): string {
    return this.choose(`cue:${flag}`, TECHNIQUE_CUES[flag].cues[this.personality]);
  }

  /** Lead-in + a short cue (<= 8 words), for the last cue before a fault is retired. */
  finalCue(flag: TechniqueFlag): string {
    const short = TECHNIQUE_CUES[flag].cues[this.personality].filter((c) => c.split(/\s+/).length <= 8);
    return `${this.say('finalWarning')} ${this.choose(`final:${flag}`, short)}`;
  }

  improved(flag: TechniqueFlag): string {
    return this.say('improved', { what: TECHNIQUE_CUES[flag].what });
  }
}
