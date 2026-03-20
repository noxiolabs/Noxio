/** @type {import('tailwindcss').Config} */
export default {
  content: ['./renderer/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Noxio dark palette — room to expand in UI phase
        surface: {
          900: '#0f0f11',
          800: '#18181b',
          700: '#27272a',
          600: '#3f3f46',
        },
        accent: {
          DEFAULT: '#7c3aed',
          hover: '#6d28d9',
        },
      },
    },
  },
  plugins: [],
};
