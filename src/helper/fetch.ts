import * as Bob from "@bob-plug/core";
import axios, { AxiosRequestConfig, AxiosPromise } from "axios";
import { createDebug, packageVersion } from "./utils";
import { OpenApiResponse } from "./types";

const debug = createDebug("fetch");
const ua = `volc-sdk-nodejs/v${packageVersion}`;

export default async function request(
  url: string,
  reqInfo: AxiosRequestConfig
): Promise<any> {
  const { headers = {} } = reqInfo;
  const reqOption: AxiosRequestConfig = {
    url: url.trim(),
    timeout: 10000,
    ...reqInfo,
    // TODO: remove proxy
    // proxy: process.env.VOLC_PROXY_PORT
    //   ? {
    //       protocol: "http",
    //       host: process.env.VOLC_PROXY_HOST || "127.0.0.1",
    //       port: +process.env.VOLC_PROXY_PORT,
    //     }
    //   : undefined,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
      "User-Agent": ua,
    },
    validateStatus: null,
    adapter(config) {
      return Bob.api.$http.request({
        url: config.url,
        // @ts-expect-error
        method: config.method,
        header: config.headers,
        body: Bob.api.$data.fromUTF8(config.data),
        timeout: 5000,
      });
    },
  };
  debug("fetch begin. options: %j", reqOption);
  const res = await axios(reqOption);
  const body = res.data;
  debug("fetch end. headers: %j response: %j", res.headers, body);
  return body;
}
