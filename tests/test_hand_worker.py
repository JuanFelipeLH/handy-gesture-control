import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('hand_worker', Path(__file__).parents[1] / 'hand_worker.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def hand(x=.25, y=.5, pinched=False):
    points = [SimpleNamespace(x=x, y=y) for _ in range(21)]
    points[5].x = x - .1; points[17].x = x + .1
    points[4].x = x - (.01 if pinched else .12)
    points[8].x = x + (.01 if pinched else .12)
    return points

class Gestures(unittest.TestCase):
    def arm(self, tracker, x=.25):
        tracker.feed(hand(x=x), 0)
        tracker.feed(hand(x=x), .4)
        tracker.feed(hand(x=x,pinched=True), .5)
        event=tracker.feed(hand(x=x,pinched=True), 1)
        self.assertEqual(event['event'],'arm')
        self.assertEqual((event['x'], event['y']), (x,.5))
        return event['token']
    def test_continuous_drag_both_axes_and_release_without_jump(self):
        tracker=module.Gesture();token=self.arm(tracker)
        previous=.25
        for i in range(1,11):
            event=tracker.feed(hand(x=.25+i*.04,y=.5+i*.02,pinched=True),1+i*.05)
            self.assertEqual((event['event'],event['token']),('drag',token))
            self.assertGreater(event['x'],previous);previous=event['x']
            self.assertGreater(event['y'],.5)
        event=tracker.feed(hand(x=.95,y=.95),1.6)
        self.assertEqual(event,{'event':'release','token':token})
        self.assertIsNone(tracker.feed(hand(pinched=True),1.7))
    def test_vertical_drag_and_holds_longer_than_four_seconds_are_allowed(self):
        tracker=module.Gesture();self.arm(tracker)
        self.assertEqual(tracker.feed(hand(y=.85,pinched=True),6)['event'],'drag')
    def test_no_arm_without_open_or_with_short_pinch(self):
        tracker=module.Gesture()
        for t in [0,1,2]:self.assertIsNone(tracker.feed(hand(pinched=True),t))
        tracker.feed(hand(),3);tracker.feed(hand(),3.4)
        tracker.feed(hand(pinched=True),3.5)
        self.assertIsNone(tracker.feed(hand(),3.6))
        self.assertIsNone(tracker.token)
    def test_lost_hand_cancels_and_cannot_reacquire_while_pinched(self):
        tracker=module.Gesture();token=self.arm(tracker)
        self.assertEqual(tracker.feed(None,1.2),{'event':'cancel','token':token})
        self.assertIsNone(tracker.feed(hand(pinched=True),1.3))
        self.assertIsNone(tracker.feed(hand(pinched=True),2.3))
    def test_small_jitter_is_smoothed(self):
        tracker=module.Gesture();self.arm(tracker)
        event=tracker.feed(hand(x=.252,pinched=True),1.04)
        self.assertGreater(event['x'],.25);self.assertLess(event['x'],.252)
    def test_rearming_gets_new_token(self):
        tracker=module.Gesture();token=self.arm(tracker)
        tracker.feed(hand(),1.1)
        tracker.feed(hand(),2);tracker.feed(hand(),2.4)
        tracker.feed(hand(pinched=True),2.5)
        event=tracker.feed(hand(pinched=True),3)
        self.assertEqual(event['event'],'arm');self.assertNotEqual(event['token'],token)

if __name__=='__main__':unittest.main()
