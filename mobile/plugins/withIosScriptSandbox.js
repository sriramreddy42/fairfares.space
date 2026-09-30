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

    const anchor = "    )\n  end\nend\n\n\n# apple-targets-extension-loader";
    if (!config.modResults.contents.includes(anchor)) {
      throw new Error("Could not locate the FairFares Podfile post-install hook.");
    }

    config.modResults.contents = config.modResults.contents.replace(
      anchor,
      `    )${block}  end\nend\n\n\n# apple-targets-extension-loader`,
    );
    return config;
  });
};
