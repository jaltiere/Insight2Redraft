"""Canonical scoring rulesets in Sleeper ``scoring_settings`` format.

A ruleset is a flat ``dict[str, float]`` mapping a Sleeper stat key to its
per-unit point multiplier. The scoring engine is fully data-driven over this
format, so values here can be tweaked freely (or a season can use a different
ruleset entirely).
"""

DEFAULT_PPR: dict[str, float] = {
    # passing
    "pass_yd": 0.04,
    "pass_td": 4.0,
    "pass_int": -2.0,
    "pass_2pt": 2.0,
    # rushing
    "rush_yd": 0.1,
    "rush_td": 6.0,
    "rush_2pt": 2.0,
    # receiving (full PPR)
    "rec": 1.0,
    "rec_yd": 0.1,
    "rec_td": 6.0,
    "rec_2pt": 2.0,
    # misc offense
    "fum_lost": -2.0,
    "fum_rec_td": 6.0,
    # kicking
    "fgm_0_19": 3.0,
    "fgm_20_29": 3.0,
    "fgm_30_39": 3.0,
    "fgm_40_49": 4.0,
    "fgm_50p": 5.0,
    "fgmiss": -1.0,
    "xpm": 1.0,
    "xpmiss": -1.0,
    # team defense / special teams
    "def_td": 6.0,
    "def_st_td": 6.0,
    "st_td": 6.0,
    "sack": 1.0,
    "int": 2.0,
    "fum_rec": 2.0,
    "safe": 2.0,
    "blk_kick": 2.0,
    "ff": 1.0,
    "def_st_ff": 1.0,
    "def_st_fum_rec": 1.0,
    "pts_allow_0": 10.0,
    "pts_allow_1_6": 7.0,
    "pts_allow_7_13": 4.0,
    "pts_allow_14_20": 1.0,
    "pts_allow_21_27": 0.0,
    "pts_allow_28_34": -1.0,
    "pts_allow_35p": -4.0,
}
