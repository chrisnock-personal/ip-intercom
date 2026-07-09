const assert = require('assert') ;

module.exports = (req, res, next) => {
  assert(typeof req.registration === 'undefined', 'drachtio-mw-registration-parser has been used twice') ;

  if (req.method !== 'REGISTER') return next();

  if (!req.has('Contact')) {
    return res.send(400, {
      headers: {
        'X-Reason': 'Contact header is required for REGISTER requests'
      }
    });
  }

  req.registration = {};

  const contact = req.getParsedHeader('Contact') ;
  const to = req.getParsedHeader('To') ;
  const expiresHeader = req.get('Expires') ;

  let expires;
  if (contact[0].params && contact[0].params.expires) expires = parseInt(contact[0].params.expires)
  else if (typeof expires === 'undefined' && typeof expiresHeader !== 'undefined') {
    expires = parseInt(expiresHeader) ;
  }
  else return res.send(400) ;

  req.registration = {
    type: 0 === expires ? 'unregister' : 'register',
    expires: expires,
    contact: contact,
    aor: to.uri
  } ;

  next() ;
};
