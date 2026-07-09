// Same precedent as intercom-endpoint/src/jssip.d.ts: no useful types ship
// for this usage. Even though the turret only touches JsSIP's public API
// (unlike intercom-endpoint's internals-poking), header inspection on an
// incoming INVITE still needs the private-ish `session._request` — treat
// the whole module as untyped rather than fighting partial @types coverage.
declare module 'jssip';
