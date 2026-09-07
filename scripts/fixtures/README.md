# Eval image fixtures

Screenshots used by the image cases of `scripts/bot-eval-set.ts` (`npm run bot:eval`).
They are real screenshots from the chat, so they are **not committed** — put your own copies here
under these names, and the runner will pick them up. A case whose fixtures are missing is skipped.

| File | What it must show |
| --- | --- |
| `steps-7264.png` | A pedometer day view (Mi Fitness «Steps»): daily total **7264 steps**, 4.48 km, hourly bar chart. |
| `workout-flexibility.png` | A workout summary with **no step count**: 131/173 kcal, 00:24:13, 86 / 119 BPM. |
| `photo-workout.jpg` | An ordinary training photo with no text on it (gym, a run, a bike) — the caption-less case must be judged from the image alone. |
| `streak-congrats.png` | An app «Congrats!» screen: 21 exercises, 15 minutes, 1 day completed — no steps. |

The point of the last two is negative: kcal, BPM, minutes and exercise counts must never be read
as steps (extraction prompt rule 4).
