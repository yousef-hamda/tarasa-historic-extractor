/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{ts,tsx,js,jsx}',
    './ui/**/*.{ts,tsx,js,jsx}',
    './pages/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        tarasa: {
          50: '#f5f8ff',
          100: '#e0ebff',
          500: '#2a66f2',
          600: '#1b4ed8',
        },
      },
    },
  },
  plugins: [],
};
