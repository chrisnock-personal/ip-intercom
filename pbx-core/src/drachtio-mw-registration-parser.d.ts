// No types package exists for this middleware. It's a single default-export
// function `(req, res, next) => void` that populates req.registration on
// REGISTER requests (see node_modules/drachtio-mw-registration-parser/app.js)
// — the Srf type definitions already declare req.registration's shape
// (index.d.ts's SrfRequest interface), this just declares the module exists.
declare module 'drachtio-mw-registration-parser';
