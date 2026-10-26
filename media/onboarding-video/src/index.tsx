import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {Video} from './video';
registerRoot(() => <Composition id="EmojiStudio" component={Video} width={720} height={1280} fps={30} durationInFrames={900}/>);
