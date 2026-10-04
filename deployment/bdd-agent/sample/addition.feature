Feature: Addition on an organization-owned agent
  Scenario Outline: Add two values
    Given I add <a> and <b>
    Then the total is <total>
    Examples:
      | a | b | total |
      | 2 | 3 | 5     |
      | 4 | 7 | 11    |
