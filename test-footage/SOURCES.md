# Test footage sources

Third-party, openly licensed clips used for **local testing only**. They are not committed; run
`npm run fetch:footage` to download them (and derive crops if `ffmpeg` is installed).
Accessed 2026-09-26 from Wikimedia Commons. Licence and author as stated on each file page.

| File | Author | Licence | Page | Used for |
| --- | --- | --- | --- | --- |
| Jumping_jacks_and_burpees.webm (640×480, 45 s) | Taco fleur | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Jumping_jacks_and_burpees.webm | Front-facing full body, arm motion, bending, side-on burpees, loss/reacquire |
| Squat_and_Frontal_Raise.webm (640×480, 28 s) | Taco fleur | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Squat_and_Frontal_Raise.webm | Sustained side view |
| Squat_-_exercise_demonstration_video.webm (1280×720, 7 s) | FitnessScape | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Squat_-_exercise_demonstration_video.webm | Back view |
| A_woman_on_dancing_floor.webm (480×640 portrait, 40 s) | Munkaila Sulemana | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:A_woman_on_dancing_floor.webm | Crowd / multiple people, turning, portrait video |

## Derived clips (digital crops of `Jumping_jacks_and_burpees.webm`, same licence)

| File | What it tests | What it does NOT test |
| --- | --- | --- |
| derived_upper_landscape.mp4 (H.264) | Chest-up framing with hips off-screen from the first frame; MP4 decoding | A real close-up camera (upscaled 4×, blurry) |
| derived_upper_portrait.webm (VP9) | Upper-body framing in a portrait video | Same |
| derived_full_portrait.mp4 | Portrait (vertical kiosk) video, full body | Different camera perspective |
| derived_leave_reenter.mp4 | Person absent → present → absent → present (crop window jumps) | Real walking in/out of frame |

The person in these clips did not consent to this specific project; the clips are used under their
public licences for testing only and should not be redistributed in the app. Replace them with the
consented footage of your own tester for the final evaluation.
