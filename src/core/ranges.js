/**
 * Copyright 2015 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var _ = require("canal-js-utils/misc");
var assert = require("canal-js-utils/assert");

var EPSILON = 0.00001;

function nearlyEqual(a, b) {
  return Math.abs(a - b) < EPSILON;
}

function nearlyLt(a, b) {
  return a - b <= EPSILON;
}

/**
 * Returns the { start, end } buffered range
 * associated to the given timestamp.
 */
function getRange(ts, ranges) {
  var start, end, i = ranges.length;
  start = Infinity; end = -Infinity;
  while (--i >= 0 && ts < start) {
    start = ranges.start(i);
    end   = ranges.end(i);
  }
  return (ts >= start) ? { start, end } : null;
}

function getNextRangeGap(ts, ranges) {
  var i = -1, nextRangeStart;
  while (++i < ranges.length) {
    var start = ranges.start(i);
    if (start > ts) {
      nextRangeStart = start;
      break;
    }
  }

  if (nextRangeStart != null)
    return nextRangeStart - ts;
  else
    return Infinity;
}

function isRanges(ranges) {
  return (!!ranges && typeof ranges.length === "number");
}

/**
 * Returns the time-gap between the buffered
 * end limit and the given timestamp
 */
function getGap(ts, ranges) {
  var range = isRanges(ranges) ? getRange(ts, ranges) : ranges;
  return range
    ? range.end - ts
    : Infinity;
}

/**
 * Return the time gap between the current time
 * and the start of current range.
 */
function getLoaded(ts, ranges) {
  var range = isRanges(ranges) ? getRange(ts, ranges) : ranges;
  return range
    ? ts - range.start
    : 0;
}

/**
 * Returns the total size of the current range.
 */
function getSize(ts, ranges) {
  var range = isRanges(ranges) ? getRange(ts, ranges) : ranges;
  return range
    ? range.end - range.start
    : 0;
}

function bufferedToArray(ranges) {
  if (ranges instanceof BufferedRanges)
    return _.cloneArray(ranges.ranges);

  var i = -1, l = ranges.length;
  var a = Array(l);
  while (++i < l) {
    a[i] = { start: ranges.start(i), end: ranges.end(i) };
  }
  return a;
}

function isPointInRange(r, point) {
  return r.start <= point && point < r.end;
}

function findOverlappingRange(range, others) {
  for (var i = 0; i < others.length; i++) {
    if (areOverlappingRanges(range, others[i]))
      return others[i];
  }
  return null;
}

function areOverlappingRanges(r1, r2) {
  return isPointInRange(r1, r2.start) || isPointInRange(r1, r2.end) || isPointInRange(r2, r1.start);
}

function isContainedInto(r1, r2) {
  return (isPointInRange(r1, r2.start) && isPointInRange(r1, r2.end));
}

function areContiguousWithRanges(r1, r2) {
  return nearlyEqual(r2.start, r1.end) || nearlyEqual(r2.end, r1.start);
}

function unionWithOverlappingOrContiguousRange(r1, r2, bitrate) {
  var start = Math.min(r1.start, r2.start);
  var end = Math.max(r1.end, r2.end);
  return { start, end, bitrate };
}

function isOrdered(r1, r2) {
  return r1.end <= r2.start;
}

function sameBitrate(r1, r2) {
  return r1.bitrate === r2.bitrate;
}

function removeEmptyRanges(ranges) {
  for (var index = 0; index < ranges.length; index++) {
    var range = ranges[index];
    if (range.start === range.end)
      ranges.splice(index++, 1);
  }
  return ranges;
}

function mergeContiguousRanges(ranges) {
  for (var index = 1; index < ranges.length; index++) {
    var prevRange = ranges[index-1];
    var currRange = ranges[index];
    if (sameBitrate(prevRange, currRange) &&
        areContiguousWithRanges(prevRange, currRange)) {
      var unionRange = unionWithOverlappingOrContiguousRange(prevRange, currRange, currRange.bitrate);
      ranges.splice(--index, 2, unionRange);
    }
  }
  return ranges;
}

function insertInto(ranges, bitrate, start, end) {
  assert(start <= end);
  if (start == end)
    return;

  var addedRange = { start: start, end: end, bitrate: bitrate };

  // For each present range check if we need to:
  // - In case we are overlapping or contiguous:
  //   - if added range has the same bitrate as the overlapped or
  //     contiguous one, we can merge them
  //   - if added range has a different bitrate we need to insert it
  //     in place
  // - Need to insert in place, we we are completely, not overlapping
  //   and not contiguous in between two ranges.

  for (var index = 0; index < ranges.length; index++) {
    var currentRange = ranges[index];

    var overlapping = areOverlappingRanges(addedRange, currentRange);
    var contiguous = areContiguousWithRanges(addedRange, currentRange);

    // We assume ranges are ordered and two ranges can not be
    // completely overlapping.
    if (overlapping || contiguous) {
      // We need to merge the addedRange and that range.
      if (sameBitrate(addedRange, currentRange)) {
        addedRange = unionWithOverlappingOrContiguousRange(addedRange, currentRange, currentRange.bitrate);
        ranges.splice(index--, 1);
      }
      // Overlapping ranges with different bitrates.
      else if (overlapping) {
        // Added range is contained in on existing range
        if (isContainedInto(currentRange, addedRange)) {
          ranges.splice(++index, 0, addedRange);
          var memCurrentEnd = currentRange.end;
          currentRange.end = addedRange.start;
          addedRange = {
            start: addedRange.end,
            end: memCurrentEnd,
            bitrate: currentRange.bitrate,
          };
        }
        // Added range contains one existing range
        else if (isContainedInto(addedRange, currentRange)) {
          ranges.splice(index--, 1);
        }
        else if (currentRange.start < addedRange.start) {
          currentRange.end = addedRange.start;
        }
        else {
          currentRange.start = addedRange.end;
          break;
        }
      }
      // Contiguous ranges with different bitrates.
      else {
        // do nothing
        break;
      }
    } else {
      // Check the case for which there is no more to do
      if (index === 0) {
        if (isOrdered(addedRange, ranges[0])) {
          // First index, and we are completely before that range (and
          // not contiguous, nor overlapping). We just need to be
          // inserted here.
          break;
        }
      } else {
        if (isOrdered(ranges[index - 1], addedRange)
         && isOrdered(addedRange, currentRange)) {
          // We are exactly after the current previous range, and
          // before the current range, while not overlapping with none
          // of them. Insert here.
          break;
        }
      }
    }
  }

  // Now that we are sure we don't overlap with any range, just add it.
  ranges.splice(index, 0, addedRange);

  return mergeContiguousRanges(removeEmptyRanges(ranges));
}

function intersect(ranges, others) {
  for (var i = 0; i < ranges.length; i++) {
    var range = ranges[i];
    var overlappingRange = findOverlappingRange(range, others);
    if (!overlappingRange) {
      ranges.splice(i--, 1);
      continue;
    }
    if (overlappingRange.start > range.start) {
      range.start = overlappingRange.start;
    }
    if (overlappingRange.end < range.end) {
      range.end = overlappingRange.end;
    }
  }
  return ranges;
}

function BufferedRanges() {
  this.ranges = [];
  this.length = 0;
}

BufferedRanges.prototype = {
  start(i) {
    return this.ranges[i].start;
  },

  end(i) {
    return this.ranges[i].end;
  },

  hasRange(startTime, duration) {
    var endTime = startTime + duration;

    for (var i = 0; i < this.ranges.length; i++) {
      var { start, end } = this.ranges[i];

      if ((nearlyLt(start, startTime) && nearlyLt(startTime, end)) &&
          (nearlyLt(start, endTime) && nearlyLt(endTime, end)))
        return this.ranges[i];
    }

    return null;
  },

  getRange(time) {
    for (var i = 0; i < this.ranges.length; i++) {
      if (isPointInRange(this.ranges[i], time))
        return this.ranges[i];
    }
    return null;
  },

  insert(bitrate, start, end) {
    if (__DEV__) {
      assert(start >= 0);
      assert(end - start > 0);
    }
    insertInto(this.ranges, bitrate, start, end);
    this.length = this.ranges.length;
    return this.ranges;
  },

  intersect(others) {
    intersect(this.ranges, others);
    this.length = this.ranges.length;
    return this.ranges;
  }
};

module.exports = {
 getRange,
 getGap,
 getNextRangeGap,
 getLoaded,
 getSize,
 bufferedToArray,
 BufferedRanges,
};
