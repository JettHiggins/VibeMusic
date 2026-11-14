/* SPDX-License-Identifier: GPL-3.0-only
 * Export the pinned firmware's real parameter descriptors and factory patches.
 * Compiled on the host; no editor mock data is used as a source of sound. */
#include <stdio.h>
#define __attribute__(x)
#include "../vendor/sloop/firmware/host/preview.c"
static void text(const char *s) {
    putchar('"');
    for (; *s; ++s) { if (*s == '"' || *s == '\\') putchar('\\'); if ((unsigned char)*s >= 32) putchar(*s); }
    putchar('"');
}
static void desc(const param_desc_t *d) {
    printf("{\"name\":"); text(d->label);
    printf(",\"min\":%d,\"max\":%d,\"default\":%d}",d->min,d->max,d->def);
}
int main(void) {
    printf("{\"sampleRate\":%u,\"blockFrames\":%u,\"steps\":%u,\"engineParamOffset\":%u,\"parameters\":[",FS,CTL,NSTEP,P_E0);
    for (unsigned i=0;i<P_E0;i++) { if(i)putchar(',');desc(&TP[i]); }
    printf("],\"globals\":[");
    for(unsigned i=0;i<G_COUNT;i++){if(i)putchar(',');desc(&GP[i]);}
    printf("],\"engines\":[");
    for(unsigned e=0;e<NENGINES;e++) {
        const engine_t *eng=ENGINES[e]; if(e)putchar(',');printf("{\"name\":");text(eng->name);
        printf(",\"parameters\":[");for(unsigned i=0;i<8;i++){if(i)putchar(',');desc(&eng->edit[i]);}
        printf("],\"presets\":[");
        for(unsigned k=0;k<eng->npresets;k++) {
            const preset_t *pr=&eng->presets[k];int16_t p[P_COUNT];
            for(unsigned i=0;i<P_E0;i++)p[i]=TP[i].def;
            for(unsigned i=0;i<8;i++)p[P_E0+i]=pr->e[i];
            for(unsigned i=0;i<4;i++)p[P_ATK+i]=pr->env[i];
            p[P_ED_FLT]=pr->fenv;p[P_ED_FX]=preset_trim(e,k);p[P_VOICE]=pr->mono?V_LEGATO:V_POLY;
            static const unsigned fx[4]={0,24,28,36};
            for(unsigned i=0;i<4;i++){p[P_DIST+i]=pr->fx[i]?pr->fx[i]-1:fx[i];p[P_AMODE+i]=pr->arp[i]?pr->arp[i]-1:TP[P_AMODE+i].def;}
            preset_extras(p,pr);
            if(k)putchar(',');printf("{\"name\":");text(pr->name);printf(",\"parameters\":[");
            for(unsigned i=0;i<P_COUNT;i++){if(i)putchar(',');printf("%d",p[i]);}printf("]}");
        }printf("]}");
    }printf("]}\n");return 0;
}
