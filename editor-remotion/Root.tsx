import { Composition } from "remotion";
import type { Timeline } from "../shared/types";
import { EditVideo } from "./EditVideo";

const emptyTimeline: Timeline = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 30,
  src: "",
  clips: [],
  titleCards: [],
  captions: [],
  callouts: [],
  inserts: [],
};

export const Root = () => (
  <Composition
    id="Edit"
    component={EditVideo}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ timeline: emptyTimeline }}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.timeline.durationInFrames,
      fps: props.timeline.fps,
      width: props.timeline.width,
      height: props.timeline.height,
    })}
  />
);
