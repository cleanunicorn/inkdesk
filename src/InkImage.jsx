import React from "react";

export default function InkImage({ image, color, alt = "", className = "" }) {
  return <span className={"ink-image " + className} role={alt ? "img" : undefined}
    aria-label={alt || undefined} aria-hidden={alt ? undefined : true}
    style={{ backgroundColor: color, maskImage: `url("${image}")`, WebkitMaskImage: `url("${image}")` }}>
    <img src={image} alt="" draggable="false" />
  </span>;
}
