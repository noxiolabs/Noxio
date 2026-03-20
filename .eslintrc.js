module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['react', 'react-hooks'],
  rules: {
    'no-console': 'warn',
    'react/react-in-jsx-scope': 'off', // React 17+ JSX transform — no import needed
    'react/prop-types': 'off',         // Skip prop-types; TypeScript migration is post-v0.1
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
  settings: {
    react: { version: 'detect' },
  },
  ignorePatterns: ['dist/', 'release/', 'node_modules/'],
};
