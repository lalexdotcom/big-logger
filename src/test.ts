import { LG } from ".";
import { LogLevel } from "./BigLogger";

(async () => {
	// LG.scope("test").level = LogLevel.INFO;
	LG.error("error");
	const LGR = LG.scope("test");
	LG.time = true;
	LG.date = true;
	LG.stack = true;
	let count = 0;
	do {
		LGR.limit(5, "key").debug("Salut ", ++count);
	} while (count < 20);
	LGR.error("error");
	LGR.warn("warn");
	LGR.notice("notice");
	LGR.info("info");
	LGR.debug("debug");
	LGR.verb("verb");
	await new Promise(res => setTimeout(res, 100));
	LGR.wth("wth");
})();
