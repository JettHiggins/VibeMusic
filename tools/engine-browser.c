/* SPDX-License-Identifier: GPL-3.0-only
 * Browser clock/variable-block extension; upstream source stays pinned and unmodified. */
#include "../vendor/sloop/firmware/host/preview.c"
uint32_t vs_beat(void) { return clk_beat; }
uint32_t vs_phase(void) { return clk_pos; }
uint32_t vs_playing(void) { return song.playing; }
float *vs_render(uint32_t frames) {
    if (!frames || frames > CTL) return output;
    fm6_poll();
    mix_block(block, frames);
    for (uint32_t i=0;i<frames*2;i++) output[i]=clamp(block[i],-32768,32767)/32768.0f;
    return output;
}

void vs_note(uint32_t track, uint32_t note, uint32_t velocity, uint32_t on) {
    if (track >= NTRK || note > 127 || velocity > 127) return;
    if (on && velocity) input_on(&trk[track], note, velocity);
    else input_off(&trk[track], note);
}

/* Remove only this sequenced melodic note, preserving manual holds and other tracks. */
void vs_erase_note(uint32_t track, uint32_t note) {
    if (track >= NPART || note > 127) return;
    track_t *t = &trk[track];
    uint32_t keep = 0;
    for (uint32_t i = 0; i < t->seq_n && i < 4u; i++) {
        uint32_t current = t->seq_notes[i];
        if (current == note) {
            if (!live_has(t, note)) trk_note_off(t, note);
            seq_out_off(t, note);
        } else t->seq_notes[keep++] = (uint8_t)current;
    }
    t->seq_n = (uint8_t)keep;
    if (!keep) { t->seq_hold = 0; t->slide_glide = 0; }
}
