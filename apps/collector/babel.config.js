module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Lets `import migrations from '../drizzle/migrations'` inline the generated .sql files
    // into the bundle, which is how drizzle-kit's `driver: 'expo'` output reaches the
    // device. Without it the import resolves to nothing and useMigrations silently applies
    // no schema.
    plugins: [["inline-import", { extensions: [".sql"] }]],
  };
};
