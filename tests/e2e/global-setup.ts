import setup from "../integration/global-setup";

export default function globalSetup() {
  setup(); // local stack URLs/keys → process.env.TEST_*
}
