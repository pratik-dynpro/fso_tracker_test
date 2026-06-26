/** @type {import('next').NextConfig} */
const isCapacitor = process.env.BUILD_TARGET === 'capacitor';

const nextConfig = {
  reactStrictMode: true,
  ...(isCapacitor
    ? {
        output: 'export',
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
