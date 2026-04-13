export enum Round {
  None = "None",
  Normal = "Normal",
  Up = "Up",
  Down = "Down",
}

export enum ExpectedValue {
  None = "None",
  Average = "Average",
  Roll = "Roll",
}

export interface RollerOptions {
  shouldRender?: boolean;
  expectedValue?: ExpectedValue;
  round?: Round;
}
