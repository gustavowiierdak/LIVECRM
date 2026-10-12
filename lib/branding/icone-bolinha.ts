import { ImageResponse } from "next/og";
import { createElement } from "react";

/** PNG transparente; o preenchimento é exatamente a cor escolhida em Marca. */
export function iconeBolinha(cor: string, cacheControl: string): ImageResponse {
  return new ImageResponse(
    createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "transparent",
        },
      },
      createElement("div", {
        style: { width: 52, height: 52, borderRadius: "50%", backgroundColor: cor },
      }),
    ),
    {
      width: 64,
      height: 64,
      headers: { "cache-control": cacheControl, "x-content-type-options": "nosniff" },
    },
  );
}
