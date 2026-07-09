# drachtio-mw-registration-parser [![Build Status](https://secure.travis-ci.org/davehorton/drachtio-mw-registration-parser.png)](http://travis-ci.org/davehorton/drachtio-mw-registration-parser) [![NPM version](https://badge.fury.io/js/drachtio-mw-registration-parser.svg)](http://badge.fury.io/js/drachtio-mw-registration-parser)

drachtio middleware for parsing SIP registration messages.  This middleware no affect on SIP requests other than REGISTER; for incoming
REGISTER messages it will augment the passed `req` object by attaching a `registration` property containing useful details about 
the register (or unregister) request. 

## Usage
```js
const Srf = require('drachtio-srf');
const srf = new Srf();
const regParser = require('drachtio-mw-registration-parser') ;

srf.connect({...}) ;

srf.use(regParser) ;

srf.register((req, res) => {
  console.log(req.registration) ;
  /*
    REGISTER sip:drachtio.org SIP/2.0
    Via: SIP/2.0/UDP 10.128.77.170:5060;branch=z9hG4bK1sansay2357115221rdb9676
    To: <sip:167356@10.128.77.12>
    From: "503" <sip:167356@10.128.77.12>;tag=sansay2357115221rdb9676
    Call-ID: 1153979666-0-659259900@72.1.47.171
    CSeq: 1 REGISTER
    Contact: <sip:167356@10.128.77.170:5060;transport=udp;jtr=5882-1>;expires=3600
    Authorization: Digest username="167356",realm="sip.drachtio.org",nonce="4fe61e6b-ccb8-47c8-8302-27be8f0b80fd",uri="sip:72.1.46.10:5061",algorithm=MD5,response="9a75860d5f13d8e1067a1e5f5c24e261",qop=auth,nc=000003e9,cnonce="cf1bb785"
    User-Agent: Cisco/SPA525G2-7.6.1(ES_RC01)
    Allow: ACK, BYE, CANCEL, INFO, INVITE, NOTIFY, OPTIONS, REFER, UPDATE
    Max-Forwards: 69
    Content-Length: 0
    
    console.log =>
    {
      type":"register",
      "expires":3600,
      "contact":[
        {
          "uri":"sip:167356@10.128.77.170:5060;transport=udp;jtr=5882-1",
          "params":{"expires":"3600"}
        }
      ],
      "aor":"sip:167356@10.128.77.12"
    }
   */
}) ;
```