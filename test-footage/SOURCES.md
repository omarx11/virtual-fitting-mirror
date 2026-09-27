# Test footage sources

Third-party, openly licensed clips used for **local testing only**. They are not committed; run
`npm run fetch:footage` to download them (and derive crops if `ffmpeg` is installed).
Accessed 2026-09-26 from Wikimedia Commons. Licence and author as stated on each file page.

| File | Author | Licence | Page | Used for |
| --- | --- | --- | --- | --- |
| Jumping_jacks_and_burpees.webm (640×480, 45 s) | Taco fleur | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Jumping_jacks_and_burpees.webm | Front-facing full body, arm motion, bending, side-on burpees, loss/reacquire |
| Squat_and_Frontal_Raise.webm (640×480, 28 s) | Taco fleur | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Squat_and_Frontal_Raise.webm | Sustained side view |
| Squat_-_exercise_demonstration_video.webm (1280×720, 7 s) | FitnessScape | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Squat_-_exercise_demonstration_video.webm | Back view |

## Derived clips (digital crops of `Jumping_jacks_and_burpees.webm`, same licence)

| File | What it tests | What it does NOT test |
| --- | --- | --- |
| derived_upper_landscape.mp4 (H.264) | Chest-up framing with hips off-screen from the first frame; MP4 decoding | A real close-up camera (upscaled 4×, blurry) |
| derived_full_portrait.mp4 | Portrait (vertical kiosk) video, full body | Different camera perspective |

## Retired clips (removed from the kit on 2026-09-27)

These were part of the original real-footage checks, and some results in `docs/TESTING.md` and
`docs/LIMITATIONS.md` came from them. They are no longer downloaded or derived, so those checks
cannot be re-run from this kit; they are listed here for credit and traceability.

| File | Source | Licence | Was used for |
| --- | --- | --- | --- |
| A_woman_on_dancing_floor.webm (480×640 portrait, 40 s) | Munkaila Sulemana, https://commons.wikimedia.org/wiki/File:A_woman_on_dancing_floor.webm | CC BY-SA 4.0 | Crowd / multiple people, turning, portrait video |
| derived_upper_portrait.webm (VP9) | Crop of `Jumping_jacks_and_burpees.webm` | CC BY-SA 4.0 | Upper-body framing in a portrait video |
| derived_leave_reenter.mp4 | Crop of `Jumping_jacks_and_burpees.webm` (crop window jumps) | CC BY-SA 4.0 | Person absent → present → absent → present |

The person in these clips did not consent to this specific project; the clips are used under their
public licences for testing only and should not be redistributed in the app. Replace them with the
consented footage of your own tester for the final evaluation.
