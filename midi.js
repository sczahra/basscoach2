// midi.js — minimal built-in MIDI parser (no external libraries)
// Supports standard SMF, extracts note on/off with timing.

function readVarLen(data, idx) {
  let value = 0;
  let b;
  do {
    b = data[idx++];
    value = (value << 7) | (b & 0x7f);
  } while (b & 0x80);
  return [value, idx];
}

export async function parseMidiFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let i = 0;

  // Header
  if (String.fromCharCode(...buf.slice(0,4)) !== "MThd")
    throw new Error("Not a MIDI file");
  const format = (buf[8]<<8)|buf[9];
  const ntrks = (buf[10]<<8)|buf[11];
  const division = (buf[12]<<8)|buf[13];
  i = 14;

  let tempo = 500000; // default 120 BPM
  const events = [];

  for (let t=0; t<ntrks; t++) {
    if (String.fromCharCode(...buf.slice(i,i+4)) !== "MTrk") break;
    let len = (buf[i+4]<<24)|(buf[i+5]<<16)|(buf[i+6]<<8)|buf[i+7];
    i += 8;
    const end = i + len;

    let time = 0;
    let lastStatus = 0;

    while (i < end) {
      let delta;
      [delta, i] = readVarLen(buf, i);
      time += delta;

      let status = buf[i];
      if (status < 0x80) {
        status = lastStatus;
      } else {
        i++;
        lastStatus = status;
      }

      if (status === 0xFF) { // meta
        const type = buf[i++];
        let l; [l, i] = readVarLen(buf, i);
        if (type === 0x51) {
          tempo = (buf[i]<<16)|(buf[i+1]<<8)|buf[i+2];
        }
        i += l;
      } else if ((status & 0xF0) === 0x90) { // note on
        const note = buf[i++];
        const vel = buf[i++];
        if (vel > 0) {
          events.push({ tick: time, midi: note, on: true });
        } else {
          events.push({ tick: time, midi: note, on: false });
        }
      } else if ((status & 0xF0) === 0x80) { // note off
        const note = buf[i++];
        i++;
        events.push({ tick: time, midi: note, on: false });
      } else {
        // skip other events (2 bytes)
        i += 2;
      }
    }
  }

  // Pair note on/off
  const noteOns = {};
  const notes = [];
  events.forEach(ev => {
    if (ev.on) {
      noteOns[ev.midi] = ev.tick;
    } else if (noteOns[ev.midi] != null) {
      const start = noteOns[ev.midi];
      const dur = ev.tick - start;
      delete noteOns[ev.midi];
      const secPerTick = (tempo/1000000) / division;
      notes.push({
        time: start * secPerTick,
        duration: dur * secPerTick,
        midi: ev.midi,
        velocity: 0.8
      });
    }
  });

  const duration = notes.length
    ? Math.max(...notes.map(n => n.time + n.duration))
    : 0;

  return { events: notes, duration };
}
