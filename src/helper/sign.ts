import hmacSHA256 from "crypto-js/hmac-sha256";
import SHA256 from "crypto-js/sha256";
import { RequestObj, SignerOptions, Credentials } from "./types";

const util = {
  crypto: {
    hmac: function hmac(key, string) {
      return hmacSHA256(string, key);
    },

    sha256: function sha256(data) {
      return SHA256(data);
    },
  },
};

const unsignableHeaders = [
  "authorization",
  "content-type",
  "content-length",
  "user-agent",
  "presigned-expires",
  "expect",
];
const constant = {
  algorithm: "HMAC-SHA256",
  v4Identifier: "request",
  dateHeader: "X-Date",
  tokenHeader: "x-security-token",
  contentSha256Header: "X-Content-Sha256",
  kDatePrefix: "",
};
const uriEscape = (str) => {
  try {
    return encodeURIComponent(str)
      .replace(/[^A-Za-z0-9_.~\-%]+/g, escape)
      .replace(/[*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch (e) {
    return "";
  }
};

export const queryParamsToString = (params) =>
  Object.keys(params)
    .map((key) => {
      const val = params[key];
      if (typeof val === "undefined" || val === null) {
        return;
      }

      const escapedKey = uriEscape(key);
      if (!escapedKey) {
        return;
      }

      if (Array.isArray(val)) {
        return `${escapedKey}=${val.map(uriEscape).sort().join(`&${escapedKey}=`)}`;
      }

      return `${escapedKey}=${uriEscape(val)}`;
    })
    .filter((v) => v)
    .join("&");
/**
 * @api private
 */
export default class Signer {
  request: RequestObj;
  serviceName: string;
  signatureCache: boolean;
  bodySha256?: string;
  constructor(request: RequestObj, serviceName: string, options?: SignerOptions) {
    this.request = request;
    this.request.headers = request.headers || {};
    this.serviceName = serviceName;
    options = options || {};
    this.bodySha256 = options.bodySha256;
    this.request.params = this.sortParams(this.request.params);
  }

  sortParams(params) {
    const newParams = {};
    if (params) {
      Object.keys(params)
        .sort()
        .map((key) => {
          newParams[key] = params[key];
        });
    }
    return newParams;
  }

  addAuthorization(credentials: Credentials, date?: Date): void {
    const datetime = this.iso8601(date).replace(/[:\-]|\.\d{3}/g, "");
    this.addHeaders(credentials, datetime);
    this.request.headers["Authorization"] = this.authorization(credentials, datetime);
  }

  addHeaders(credentials: Credentials, datetime: string) {
    this.request.headers[constant.dateHeader] = datetime;
    if (credentials.sessionToken) {
      this.request.headers[constant.tokenHeader] = credentials.sessionToken;
    }
    if (this.request.body) {
      let body = this.request.body;
      if (typeof body !== "string") {
        // TODO: remove urlsearchParams and form-data
        // if (body instanceof URLSearchParams) {
        //   body = body.toString();
        // } else if (body instanceof FormData) {
        //   body = String(body.getBuffer());
        // } else {
          body = JSON.stringify(body);
        // }
      }
      this.request.headers[constant.contentSha256Header] =
        this.bodySha256 || util.crypto.sha256(body).toString();
    }
  }

  authorization(credentials: Credentials, datetime: string) {
    const parts: string[] = [];
    const credString = this.credentialString(datetime);
    parts.push(`${constant.algorithm} Credential=${credentials.accessKeyId}/${credString}`);
    parts.push(`SignedHeaders=${this.signedHeaders()}`);
    // parts.push(`SignedQueries=${this.signedQueries()}`);
    parts.push(`Signature=${this.signature(credentials, datetime)}`);
    return parts.join(", ");
  }

  signature(credentials: Credentials, datetime: string) {
    const signingKey = this.getSigningKey(
      credentials,
      datetime.substr(0, 8),
      this.request.region,
      this.serviceName
    );
    return util.crypto.hmac(signingKey, this.stringToSign(datetime));
  }

  stringToSign(datetime: string) {
    const parts: string[] = [];
    parts.push(constant.algorithm);
    parts.push(datetime);
    parts.push(this.credentialString(datetime));
    parts.push(this.hexEncodedHash(this.canonicalString()).toString());
    return parts.join("\n");
  }

  canonicalString(): string {
    const parts: string[] = [],
      pathname = this.request.pathname || "/";

    parts.push(this.request.method.toUpperCase());
    parts.push(pathname);
    const queryString = queryParamsToString(this.request.params) || "";
    parts.push(queryString);
    parts.push(`${this.canonicalHeaders()}\n`);
    parts.push(this.signedHeaders());
    parts.push(this.hexEncodedBodyHash());
    return parts.join("\n");
  }

  canonicalHeaders() {
    const headers: [string, string][] = [];
    Object.keys(this.request.headers).forEach((key) => {
      headers.push([key, this.request.headers[key]]);
    });
    headers.sort((a, b) => (a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1));
    const parts: string[] = [];
    headers.forEach((item) => {
      const key = item[0].toLowerCase();
      if (this.isSignableHeader(key)) {
        const value = item[1];
        if (
          typeof value === "undefined" ||
          value === null ||
          typeof value.toString !== "function"
        ) {
          throw new Error(`Header ${key} contains invalid value`);
        }
        parts.push(`${key}:${this.canonicalHeaderValues(value.toString())}`);
      }
    });
    return parts.join("\n");
  }

  canonicalHeaderValues(values: string) {
    return values.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }

  signedHeaders() {
    const keys: string[] = [];
    Object.keys(this.request.headers).forEach((key) => {
      key = key.toLowerCase();
      if (this.isSignableHeader(key)) {
        keys.push(key);
      }
    });
    return keys.sort().join(";");
  }

  signedQueries() {
    return Object.keys(this.request.params).join(";");
  }

  credentialString(datetime: string) {
    return this.createScope(datetime.substr(0, 8), this.request.region, this.serviceName);
  }

  hexEncodedHash(str: string) {
    return util.crypto.sha256(str);
  }

  hexEncodedBodyHash() {
    if (this.request.headers[constant.contentSha256Header]) {
      return this.request.headers[constant.contentSha256Header];
    }

    if (this.request.body) {
      return this.hexEncodedHash(queryParamsToString(this.request.body));
    }
    return this.hexEncodedHash("");
  }

  isSignableHeader(key: string) {
    return unsignableHeaders.indexOf(key) < 0;
  }

  iso8601(date?: Date) {
    if (date === undefined) {
      date = new Date();
    }
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  getSigningKey(credentials: Credentials, date: string, region: string, service: string) {
    const kDate = util.crypto.hmac(`${constant.kDatePrefix}${credentials.secretKey}`, date);
    const kRegion = util.crypto.hmac(kDate, region);
    const kService = util.crypto.hmac(kRegion, service);

    const signingKey = util.crypto.hmac(kService, constant.v4Identifier);

    return signingKey;
  }

  createScope(date: string, region: string, serviceName: string) {
    return [date.substr(0, 8), region, serviceName, constant.v4Identifier].join("/");
  }
}
