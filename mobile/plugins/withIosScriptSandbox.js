const { withPodfile } = require("expo/config-plugins");

const marker = "# FairFares Xcode 26 codegen compatibility";
const block = `
    ${marker}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        build_configuration.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
      end
    end
`;

module.exports = function withIosScriptSandbox(config) {
  return withPodfile(config, (config) => {
    if (config.modResults.contents.includes(marker)) {
      return config;
    }

    // Expo SDK 54 no longer appends the apple-targets loader comment after the
    // React Native post-install block. Insert directly before the enclosing
    // post_install/target closures so this works for both Podfile layouts.
    const anchor = "    )\n  end\nend";
    if (!config.modResults.contents.includes(anchor)) {
      throw new Error("Could not locate the FairFares Podfile post-install hook.");
    }

    config.modResults.contents = config.modResults.contents.replace(
      anchor,
      `    )${block}  end\nend`,
    );
    return config;
  });
};
