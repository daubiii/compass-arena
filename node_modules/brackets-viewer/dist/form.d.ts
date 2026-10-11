import { InputStage } from 'brackets-model';
export type CallbackFunction = (config: InputStage) => void;
export type FormConfiguration = {
    parent_id: string;
    html_name_id: string;
    html_stage_type_selector_id: string;
    html_team_names_input_id: string;
    html_team_count_input_id: string;
    html_group_id: string;
    html_seed_order_id: string;
    html_round_robin_mode_id: string;
    html_consolation_final_checkbox_id: string;
    html_skip_first_round_checkbox_id: string;
    html_grand_final_type_id: string;
    html_double_elimination_seed_textarea_id: string;
    group_default_size: number;
};
/**
 * Creates a DOM form to create different stages for the brackets-manager
 *
 * @param configuration HTML element IDs to render this form to
 * @param submitCallable Callback function - what should happen onClick on the forms submit button?
 */
export declare function stageFormCreator(configuration: FormConfiguration, submitCallable: CallbackFunction): void;
/**
 * Creates a DOM form to update the current stage.
 *
 * @param configuration HTML element IDs to render this form to
 * @param changeCallable Callback function - what should happen onClick on the forms submit button?
 */
export declare function updateFormCreator(configuration: FormConfiguration, changeCallable: CallbackFunction): void;
